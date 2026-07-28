import { createMiddleware } from "hono/factory";

export const zohoWebhookMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { rawBody: string };
}>(async (c, next) => {
  const rawBody = await c.req.text();
  const signatureHeader = c.req.header("X-Zoho-Webhook-Signature");

  if (!signatureHeader) return c.body(null, 400);

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((s) => {
      const [k, ...v] = s.trim().split("=");
      return [k, v.join("=")];
    }),
  );

  const timestamp = parts["t"];
  const receivedSig = parts["v1"] || parts["v"];

  if (!timestamp || !receivedSig) return c.body(null, 400);

  const dataToSign = `${timestamp}.${rawBody}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(c.env.ZOHO_WEBHOOK_SIGNING_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(dataToSign),
  );

  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expected !== receivedSig) return c.body(null, 401);

  c.set("rawBody", rawBody);

  await next();
});