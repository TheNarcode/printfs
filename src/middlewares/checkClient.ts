import { createMiddleware } from "hono/factory";

export const checkClientMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { rawBody: string };
}>(async (c, next) => {
  const signature = c.req.header("X-Printf-Key");
  if (!signature) return c.body(null, 400);
  if (signature !== c.env.PRINTF_WEBHOOK_SECRET) return c.body(null, 401);
  await next();
});