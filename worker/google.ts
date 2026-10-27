// The three calls that make up "Sign in with Google" (OAuth 2.0 authorization code flow):
// send the browser to Google, swap the code Google sends back for an access token, read the
// profile with it. Kept free of Hono so route tests can mock googleProfile the way they
// mock tagNote. No library: this is the whole flow.
import { HTTPException } from "hono/http-exception";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export type GoogleProfile = {
  sub: string; // Google's stable id for the account
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
};

// Where the browser goes to pick an account. state is echoed back on the callback, so the
// route can tell Google's redirect from a forged one.
export function authorizeUrl({ clientId, redirectUri, state }: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

const failed = () => new HTTPException(502, { message: "Google sign-in failed" });

// The profile behind a code from the callback. The code is single-use and tied to the
// redirect URI it was issued for, which must be sent again here.
export async function googleProfile({ code, redirectUri, clientId, clientSecret }: { code: string; redirectUri: string; clientId: string; clientSecret: string }): Promise<GoogleProfile> {
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!tokenRes.ok) {
    console.error("Google token exchange failed", tokenRes.status, await tokenRes.text());
    throw failed();
  }
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw failed();

  const profileRes = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${access_token}` } });
  if (!profileRes.ok) {
    console.error("Google userinfo failed", profileRes.status, await profileRes.text());
    throw failed();
  }
  const profile = (await profileRes.json()) as Partial<GoogleProfile>;
  if (!profile.sub || !profile.email) throw failed();
  return { sub: profile.sub, email: profile.email, email_verified: profile.email_verified === true, name: profile.name, picture: profile.picture };
}
