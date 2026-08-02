import { createMiddleware } from "hono/factory";
import { oAuthClient } from "../services/googleAuth";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { isAllowedDomain } from "../constants";

export interface UnifiedTokenPayload {
  sub: string;
  email: string;
  name: string;
  picture?: string | null;
  [key: string]: any;
}

const auth = createMiddleware<{
  Variables: { payload: UnifiedTokenPayload };
  Bindings: Env;
}>(async (c, next) => {
  const authHeader = c.req.header("xxx-auth-token");
  if (!authHeader) return c.body(null, 401);

  try {
    const parts = authHeader.split('.');
    if (parts.length !== 3) return c.body(null, 401);
    const unverifiedPayload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

    let payload: UnifiedTokenPayload | null = null;

    if (unverifiedPayload.iss === 'https://accounts.google.com') {
      const ticket = await oAuthClient.verifyIdToken({
        idToken: authHeader,
        audience: c.env.GOOGLE_AUTH_ID,
      });
      const googlePayload = ticket.getPayload();
      if (googlePayload) {
        payload = {
          sub: googlePayload.sub,
          email: googlePayload.email || '',
          name: googlePayload.name || 'User',
          picture: googlePayload.picture,
        };
      }
    } else if (unverifiedPayload.iss === `https://securetoken.google.com/${c.env.FIREBASE_PROJECT_ID}`) {
      if (!getApps().length) {
        initializeApp({
          credential: cert({
            projectId: c.env.FIREBASE_PROJECT_ID,
            clientEmail: c.env.FIREBASE_CLIENT_EMAIL,
            privateKey: c.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
          }),
        });
      }
      
      const decodedToken = await getAuth().verifyIdToken(authHeader);
      payload = {
        sub: decodedToken.uid,
        email: decodedToken.email || '',
        name: decodedToken.name || 'User',
        picture: decodedToken.picture,
      };
    } else {
      return c.body(null, 401);
    }

    if (!payload || !payload.email) return c.body(null, 422);

    if (!isAllowedDomain(payload.email)) {
      return c.body(null, 403);
    }

    c.set("payload", payload);
    await next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return c.body(null, 401);
  }
});

export { auth as authMiddleware };