import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import db from "../database/index";
import { metadata, orders, files } from "../database/schema";
import { eq, desc, like } from "drizzle-orm";
import { authMiddleware } from "../middlewares/auth";
import { PrintConfig } from "../types/index";
import { getZohoAccessToken } from "../services/zohoAuth";
import shortUniqueId from "short-unique-id";
import { getUniquePrintPageCount } from "..";
import { resolveFooterOption, generateQueueTokenId } from "../constants";

const sui = new shortUniqueId({ dictionary: "alpha_lower", length: 5 });

const app = new Hono<{ Bindings: Env }>();

app.post(
  "/create",
  authMiddleware,
  zValidator("json", z.object({
    files: z.array(PrintConfig),
    footer: z.boolean().optional(),
  })),
  async (c) => {
    const database = db(c.env.PRINTFDB);
    const body = c.req.valid("json");
    const payload = c.get("payload");

    const filesData = body.files;
    const requestedFooterOption = body.footer;

    const metadataResponses = await Promise.all(
      filesData.map((file) =>
        database.query.metadata.findFirst({
          where: eq(metadata.fileId, file.fileId),
          columns: { pages: true, type: true },
        }),
      ),
    );

    if (metadataResponses.some((m) => !m)) return c.body(null, 400);

    const { footer, extraCost } = resolveFooterOption(
      payload.email,
      requestedFooterOption,
    );

    let totalAmount = 0;

    for (let i = 0; i < filesData.length; i++) {
      const file = filesData[i];
      const meta = metadataResponses[i]!;

      const pageCount = getUniquePrintPageCount(file.pageRanges, meta.pages);
      const copies = parseInt(file.copies) || 1;
      const numberUp = parseInt(file.numberUp) || 1;
      const effectivePages = Math.ceil(pageCount / numberUp);
      const isColor = file.color?.toLowerCase() === "color";
      const price = isColor
        ? file.sides === "one-sided"
          ? 6
          : 12
        : file.sides === "one-sided"
          ? effectivePages * copies === 1
            ? 3
            : 2.5
          : 2;

      totalAmount += effectivePages * copies * price;
    }

    totalAmount += extraCost;

    totalAmount = Math.round(totalAmount * 105) / 100;

    const amountInRupees = totalAmount.toFixed(2);
    const accessToken = await getZohoAccessToken(c.env);

    const zohoRes = await fetch(
      `${c.env.ZOHO_PAYMENTS_BASE_URL}/paymentsessions?account_id=${c.env.ZOHO_ACCOUNT_ID}`,
      {
        method: "POST",
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          "Content-Type": "application/json",
          "X-com-zoho-payments-organizationid": c.env.ZOHO_ACCOUNT_ID,
        },
        body: JSON.stringify({
          amount: amountInRupees,
          currency: "INR",
          description: `print order - ${new Date().toISOString()}`,
        }),
      },
    );

    if (!zohoRes.ok) {
      const errText = await zohoRes.text();
      console.error("Zoho payment session creation failed:", errText);
      return c.body(null, 502);
    }

    const zohoData = (await zohoRes.json()) as {
      payments_session?: {
        payments_session_id: string;
      };
      payments_session_id?: string;
      message?: string;
      [key: string]: unknown;
    };

    const paymentsSessionId =
      zohoData.payments_session?.payments_session_id ||
      zohoData.payments_session_id;

    if (!paymentsSessionId) {
      console.error("Zoho payment session missing in response:", zohoData);
      return c.body(null, 502);
    }

    const now = new Date();
    const day = now.getDate().toString().padStart(2, "0");
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const year = now.getFullYear().toString();
    const dateStr = `${day}${month}${year}`;

    const latestOrder = await database.query.orders.findFirst({
      where: like(orders.queueTokenId, `%-${dateStr}`),
      orderBy: [desc(orders.createdAt)],
    });

    let nextSeq = 1;
    if (latestOrder && latestOrder.queueTokenId) {
      const parts = latestOrder.queueTokenId.split("-");
      if (parts[0] && parts[0].length === 5) {
        const prevSeqStr = parts[0].substring(1);
        const prevSeq = parseInt(prevSeqStr, 10);
        if (!isNaN(prevSeq)) {
          nextSeq = prevSeq + 1;
        }
      }
    }

    const orderId = sui.rnd();
    const queueTokenId = generateQueueTokenId(nextSeq, now);

    const batchQueries = [
      database.insert(orders).values({
        id: orderId,
        amount: Number(amountInRupees),
        email: payload.email!,
        paymentRequestId: paymentsSessionId,
        footer,
        queueTokenId,
      }),
      database
        .insert(files)
        .values(filesData.map((file) => ({ order: orderId, ...file }))),
    ];

    // order must be a transaction
    await database.batch(batchQueries as any);

    return c.json({
      payments_session_id: paymentsSessionId,
      localOrderId: orderId,
      queueTokenId,
      amount: amountInRupees
    });
  },
);

app.post(
  "/pay-session",
  authMiddleware,
  zValidator("json", z.object({ orderId: z.string() })),
  async (c) => {
    const database = db(c.env.PRINTFDB);
    const { orderId } = c.req.valid("json");
    const payload = c.get("payload");

    const order = await database.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });

    if (!order || order.email !== payload.email) {
      return c.body(null, 404);
    }

    if (order.paid) {
      return c.json({ error: "Order is already paid" }, 400);
    }

    const amountInRupees = order.amount.toFixed(2);
    const accessToken = await getZohoAccessToken(c.env);

    const zohoRes = await fetch(
      `${c.env.ZOHO_PAYMENTS_BASE_URL}/paymentsessions?account_id=${c.env.ZOHO_ACCOUNT_ID}`,
      {
        method: "POST",
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          "Content-Type": "application/json",
          "X-com-zoho-payments-organizationid": c.env.ZOHO_ACCOUNT_ID,
        },
        body: JSON.stringify({
          amount: amountInRupees,
          currency: "INR",
          description: `print order ${orderId} - ${new Date().toISOString()}`,
        }),
      },
    );

    if (!zohoRes.ok) {
      const errText = await zohoRes.text();
      console.error("Zoho payment session creation failed:", errText);
      return c.body(null, 502);
    }

    const zohoData = (await zohoRes.json()) as {
      payments_session?: {
        payments_session_id: string;
      };
      payments_session_id?: string;
    };

    const paymentsSessionId =
      zohoData.payments_session?.payments_session_id ||
      zohoData.payments_session_id;

    if (!paymentsSessionId) {
      console.error("Zoho payment session missing in response:", zohoData);
      return c.body(null, 502);
    }

    await database
      .update(orders)
      .set({ paymentRequestId: paymentsSessionId })
      .where(eq(orders.id, orderId));

    return c.json({
      payments_session_id: paymentsSessionId,
      localOrderId: orderId,
      amount: amountInRupees,
    });
  },
);

app.get("/list", authMiddleware, async (c) => {
  const payload = c.get("payload");
  const database = db(c.env.PRINTFDB);

  const result = await database.query.orders.findMany({
    where: eq(orders.email, payload.email!),
    orderBy: [desc(orders.createdAt)],
    limit: 50,
    with: {
      files: {
        with: {
          metadata: true,
        },
      },
    },
  });

  return c.json(result);
});


export default app;
