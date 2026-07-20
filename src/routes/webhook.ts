import { Hono } from "hono";
import db from "../database/index";
import { asc, eq, inArray } from "drizzle-orm";
import { orders, files, fcmTokens } from "../database/schema";
import { getMessaging } from "firebase-admin/messaging";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { Redis } from "@upstash/redis/cloudflare";
import { zohoWebhookMiddleware } from "../middlewares/zohoWebhook";
import { checkClientMiddleware } from "../middlewares/checkClient.js";

const app = new Hono<{ Bindings: Env }>();

app.post(`/payment`, zohoWebhookMiddleware, async (c) => {
  const database = db(c.env.PRINTFDB);
  const redis = new Redis({
    url: c.env.REDIS_URL,
    token: c.env.REDIS_TOKEN,
  });

  const payload = JSON.parse(c.get("rawBody"));

  // Only act on payment.succeeded and payment.failed events
  if (
    payload.event_type !== "payment.succeeded" &&
    payload.event_type !== "payment.failed"
  ) {
    return c.json({ ok: true }, 200);
  }

  // The payments_session_id links Zoho's session to our local order
  const paymentsSessionId = (payload.event_object?.payment?.payments_session_id ||
    payload.event_object?.payments_session_id) as string | undefined;

  if (!paymentsSessionId) {
    console.warn("Zoho webhook payload missing payments_session_id:", payload);
    return c.json({ ok: true }, 200);
  }

  const order = await database.query.orders.findFirst({
    where: eq(orders.paymentRequestId, paymentsSessionId),
    with: {
      files: true,
    },
  });

  if (!order) {
    console.warn(`No local order found for payments_session_id: ${paymentsSessionId}`);
    return c.json({ ok: true }, 200);
  }

  if (payload.event_type === "payment.failed") {
    await database
      .update(orders)
      .set({ status: 2 })
      .where(eq(orders.id, order.id));
    return c.json({ ok: true }, 200);
  }

  if (order.paid) return c.json({ ok: true }, 200);

  await Promise.all([
    database.update(orders).set({ paid: true }).where(eq(orders.id, order.id)),
    redis.lpush("printf_queue", JSON.stringify(order.files)),
  ]);

  return c.json({ ok: true }, 200);
});

app.post(
  "/notify",
  checkClientMiddleware,
  zValidator(
    "json",
    z.object({ id: z.string(), printerName: z.string().optional() }),
  ),
  async (c) => {
    const database = db(c.env.PRINTFDB);

    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: c.env.FIREBASE_PROJECT_ID,
          clientEmail: c.env.FIREBASE_CLIENT_EMAIL,
          privateKey: c.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
      });
    }

    let { id, printerName } = c.req.valid("json");

    const fileRecord = await database.query.files.findFirst({
      where: eq(files.fileId, id),
    });

    if (!fileRecord) return c.json({ ok: true });

    await database
      .update(files)
      .set({ printed: true })
      .where(eq(files.fileId, id));

    const allFiles = await database.query.files.findMany({
      where: eq(files.order, fileRecord.order),
    });

    const isAllPrinted = allFiles.every((f) => f.fileId === id || f.printed);

    if (!isAllPrinted) return c.json({ ok: true });

    const [order] = await Promise.all([
      database.query.orders.findFirst({
        where: eq(orders.id, fileRecord.order),
      }),
      database
        .update(orders)
        .set({ status: 1, printerName: printerName ?? null })
        .where(eq(orders.id, fileRecord.order)),
    ]);

    if (!order) return c.json({ ok: true });

    const userTokens = await database.query.fcmTokens.findMany({
      where: eq(fcmTokens.email, order.email),
    });

    if (!userTokens.length) return c.json({ ok: true });

    for (const t of userTokens) {
      try {
        await getMessaging().send({
          token: t.token,
          notification: {
            title: `Order#${order.id} completed`,
            body: "Your print order is ready for pickup.",
          },
          data: {
            orderId: fileRecord.order,
            type: "print_completed",
          },
          android: {
            priority: "high",
            notification: {
              channelId: "print_updates",
              sound: "default",
            },
          },
        });
      } catch (fcmErr: any) {
        if (
          fcmErr?.code === "messaging/invalid-registration-token" ||
          fcmErr?.code === "messaging/registration-token-not-registered"
        ) {
          await database.delete(fcmTokens).where(eq(fcmTokens.id, t.id));
        } else {
          console.error(`FCM send error for ${t.email}:`, fcmErr);
        }
      }
    }

    return c.json({ ok: true });
  },
);

export default app;
