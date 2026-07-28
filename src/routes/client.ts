import { Hono } from "hono";
import db from "../database/index.js";
import { orders, fcmTokens } from "../database/schema.js";
import { checkClientMiddleware } from "../middlewares/checkClient.js";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { asc, desc, eq } from "drizzle-orm";
import { getUniquePrintPageCount } from "../index.js";
import { getMessaging } from "firebase-admin/messaging";
import { initializeApp, getApps, cert } from "firebase-admin/app";

const app = new Hono<{ Bindings: Env }>();

app.use("*", checkClientMiddleware);

app.get("/stats", async (c) => {
  const monthParam = c.req.query("month");
  const database = db(c.env.PRINTFDB);
  const allFiles = await database.query.files.findMany({
    with: {
      metadata: true,
      order: true,
    },
  });

  const stats = {
    "b/w single sided": { prints: 0, pages: 0 },
    "b/w double sided": { prints: 0, pages: 0 },
    "color single sided": { prints: 0, pages: 0 },
    "color double sided": { prints: 0, pages: 0 },
  };

  for (const file of allFiles) {
    if (!file.order?.paid) continue;

    if (monthParam && file.order?.createdAt) {
      const date = new Date(file.order.createdAt);
      if (!isNaN(date.getTime())) {
        const monthNum = date.getMonth() + 1;
        const yearNum = date.getFullYear();
        const monthStrPadded = monthNum.toString().padStart(2, "0");
        const yyyyMm = `${yearNum}-${monthStrPadded}`;
        const monthNameLower = date
          .toLocaleString("en-US", { month: "long" })
          .toLowerCase();
        const monthShortLower = date
          .toLocaleString("en-US", { month: "short" })
          .toLowerCase();

        const paramClean = monthParam.trim().toLowerCase();
        const paramAsNum = parseInt(paramClean, 10);

        const matches =
          yyyyMm === paramClean ||
          monthNum.toString() === paramClean ||
          monthStrPadded === paramClean ||
          paramAsNum === monthNum ||
          monthNameLower === paramClean ||
          monthShortLower === paramClean ||
          `${monthNameLower} ${yearNum}` === paramClean ||
          `${monthShortLower} ${yearNum}` === paramClean;

        if (!matches) {
          continue;
        }
      }
    }

    const isColor = file.color?.toLowerCase() === "color";
    const isSingleSided = file.sides === "one-sided";

    let groupKey: keyof typeof stats;
    if (isColor) {
      groupKey = isSingleSided ? "color single sided" : "color double sided";
    } else {
      groupKey = isSingleSided ? "b/w single sided" : "b/w double sided";
    }

    const metaPages = file.metadata?.pages || 1;
    const pageCount = getUniquePrintPageCount(file.pageRanges || "", metaPages);
    const copies = parseInt(file.copies) || 1;
    const numberUp = parseInt(file.numberUp) || 1;
    const effectivePages = Math.ceil(pageCount / numberUp);

    const group = stats[groupKey];
    group.prints += 1;
    group.pages += effectivePages * copies;
  }

  return c.json(stats);
});

app.post(
  "/collect",
  zValidator("json", z.object({ orderId: z.string() })),
  async (c) => {
    const database = db(c.env.PRINTFDB);
    const { orderId } = c.req.valid("json");

    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: c.env.FIREBASE_PROJECT_ID,
          clientEmail: c.env.FIREBASE_CLIENT_EMAIL,
          privateKey: c.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
      });
    }

    const order = await database.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });

    if (!order) return c.json({ ok: false, error: "order not found" }, 404);

    await database
      .update(orders)
      .set({ status: 3 })
      .where(eq(orders.id, orderId));

    const userTokens = await database.query.fcmTokens.findMany({
      where: eq(fcmTokens.email, order.email),
    });

    for (const t of userTokens) {
      try {
        await getMessaging().send({
          token: t.token,
          notification: {
            title: `Order#${order.id} collected`,
            body: "Your print order has been collected.",
          },
          data: {
            orderId: order.id,
            type: "print_collected",
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

app.get("/completed", async (c) => {
  const database = db(c.env.PRINTFDB);

  const result = await database.query.orders.findMany({
    where: eq(orders.status, 1),
    columns: {
      id: true,
    },
    orderBy: asc(orders.id),
  });

  return c.json(result);
});

app.get("/orders", async (c) => {
  const database = db(c.env.PRINTFDB);

  const result = await database.query.orders.findMany({
    limit: 100,
    with: {
      files: true,
    },
    orderBy: desc(orders.createdAt),
  });

  return c.json(result);
});

export default app;