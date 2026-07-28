import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import db from "../database/index";
import { fcmTokens } from "../database/schema";
import { authMiddleware } from "../middlewares/auth";

const app = new Hono<{ Bindings: Env }>();

app.post(
  "/register",
  authMiddleware,
  zValidator("json", z.object({ token: z.string() })),
  async (c) => {
    const database = db(c.env.PRINTFDB);

    const { token } = c.req.valid("json");
    const payload = c.get("payload");
    const email = payload.email!;

    await database
      .insert(fcmTokens)
      .values({ email, token })
      .onConflictDoUpdate({
        target: fcmTokens.token,
        set: { email },
      });

    return c.body(null, 200);
  },
);

export default app;