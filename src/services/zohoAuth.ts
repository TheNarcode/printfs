export async function getZohoAccessToken(env: Env): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: env.ZOHO_REFRESH_TOKEN,
  });

  const res = await fetch(
    `${env.ZOHO_ACCOUNTS_URL}/oauth/v2/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );

  if (!res.ok) {
    throw new Error(`Zoho token exchange failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token?: string; error?: string };

  if (!data.access_token) {
    throw new Error(
      `Zoho token exchange returned no access_token: ${data.error ?? "unknown error"}`,
    );
  }

  return data.access_token;
}