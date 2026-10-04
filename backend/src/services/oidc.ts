import crypto from 'crypto';
import { appConfig } from '../config/config';

// Minimal OpenID Connect authorization-code + PKCE client. We only need the user's
// email, which we read from the userinfo endpoint over the back channel (TLS to the
// issuer), so the ID token isn't parsed or verified.

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

export interface OidcUserInfo {
  email?: string;
  email_verified?: boolean;
  name?: string;
}

let discoveryPromise: Promise<Discovery> | null = null;

export function isOidcEnabled(): boolean {
  const { issuer, clientId, clientSecret } = appConfig.oidc;
  return Boolean(issuer && clientId && clientSecret);
}

export function oidcRedirectUri(): string {
  return `${appConfig.appUrl.replace(/\/$/, '')}/auth/oidc/callback`;
}

function discover(): Promise<Discovery> {
  if (!discoveryPromise) {
    const url = `${appConfig.oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    discoveryPromise = fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} ${url}`);
        return (await res.json()) as Discovery;
      })
      .catch((err) => {
        discoveryPromise = null; // retry on the next login attempt
        throw err;
      });
  }
  return discoveryPromise;
}

const base64url = (buf: Buffer) => buf.toString('base64url');

export async function buildAuthorizationRequest(): Promise<{
  url: string;
  state: string;
  codeVerifier: string;
}> {
  const { authorization_endpoint } = await discover();
  const state = base64url(crypto.randomBytes(24));
  const codeVerifier = base64url(crypto.randomBytes(48));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: appConfig.oidc.clientId,
    redirect_uri: oidcRedirectUri(),
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return { url: `${authorization_endpoint}?${params}`, state, codeVerifier };
}

export async function exchangeCodeForUserInfo(code: string, codeVerifier: string): Promise<OidcUserInfo> {
  const { token_endpoint, userinfo_endpoint } = await discover();

  const tokenRes = await fetch(token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: oidcRedirectUri(),
      client_id: appConfig.oidc.clientId,
      client_secret: appConfig.oidc.clientSecret,
      code_verifier: codeVerifier,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`OIDC token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new Error('OIDC token response had no access_token');

  const infoRes = await fetch(userinfo_endpoint, {
    headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' },
  });
  if (!infoRes.ok) throw new Error(`OIDC userinfo failed: ${infoRes.status}`);
  return (await infoRes.json()) as OidcUserInfo;
}
