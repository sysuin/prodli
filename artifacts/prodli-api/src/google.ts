// Verifies Google sign-ins.
//   Extension: chrome.identity gives an OAuth *access token* → checked with
//              Google's tokeninfo endpoint (audience must be ProdLi's extension client).
//   Web:       Google Identity Services gives an *ID token* (JWT) → signature,
//              issuer, audience and expiry checked against Google's public keys.

import { createRemoteJWKSet, jwtVerify } from "jose";

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export class GoogleAuthError extends Error {}

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export async function verifyExtensionAccessToken(accessToken: string, clientId: string, fetcher: typeof fetch = fetch): Promise<GoogleIdentity> {
  if (!accessToken || accessToken.length > 4096) throw new GoogleAuthError("missing_token");
  const infoRes = await fetcher(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (!infoRes.ok) throw new GoogleAuthError("invalid_token");
  const info = (await infoRes.json()) as { aud?: string; azp?: string; sub?: string; email?: string; email_verified?: string | boolean };
  if (info.aud !== clientId && info.azp !== clientId) throw new GoogleAuthError("wrong_audience");
  if (!info.sub || !info.email) throw new GoogleAuthError("missing_identity");
  if (info.email_verified !== true && info.email_verified !== "true") throw new GoogleAuthError("email_not_verified");

  const profileRes = await fetcher("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  const profile = profileRes.ok ? ((await profileRes.json()) as { sub?: string; name?: string; picture?: string }) : {};
  if (profile.sub && profile.sub !== info.sub) throw new GoogleAuthError("identity_mismatch");
  return { sub: info.sub, email: info.email, name: profile.name ?? "", picture: profile.picture ?? null };
}

export async function verifyWebIdToken(idToken: string, clientId: string): Promise<GoogleIdentity> {
  if (!idToken || idToken.length > 8192) throw new GoogleAuthError("missing_token");
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });
    if (!payload.sub || typeof payload.email !== "string") throw new GoogleAuthError("missing_identity");
    if (payload.email_verified !== true) throw new GoogleAuthError("email_not_verified");
    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : "",
      picture: typeof payload.picture === "string" ? payload.picture : null,
    };
  } catch (err) {
    if (err instanceof GoogleAuthError) throw err;
    throw new GoogleAuthError("invalid_token");
  }
}
