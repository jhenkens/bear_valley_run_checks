import { appConfig } from '../config/config';

const RP_NAME = 'Bear Valley Run Checks';

export interface RelyingPartyConfig {
  rpID: string;
  rpName: string;
  origin: string | string[];
}

/**
 * WebAuthn ties credentials to a specific rpID (domain) and origin. Derive
 * both from appConfig.appUrl - the same source of truth already used for
 * magic link URLs and the Google OAuth callback - so passkeys automatically
 * track whatever domain the app is actually served from.
 *
 * In dev, the frontend (webpack-dev-server, :8080) and backend (:3000) run
 * on different ports, but appUrl only points at the backend. WebAuthn checks
 * the browser's real origin, so without allowing both, registering/logging
 * in with a passkey would fail whenever the page was loaded from :8080 -
 * same split this app's CORS config (index.ts) already accounts for.
 */
export function getRelyingPartyConfig(): RelyingPartyConfig {
  const url = new URL(appConfig.appUrl);
  const origin: string | string[] =
    process.env.NODE_ENV === 'production'
      ? url.origin
      : [url.origin, 'http://localhost:8080', 'http://localhost:3000'];

  return {
    rpID: url.hostname,
    rpName: RP_NAME,
    origin,
  };
}

export function userIdToUint8Array(userId: string) {
  // .slice() with no args copies into a plain ArrayBuffer-backed Uint8Array,
  // matching @simplewebauthn/server's Uint8Array_ (never SharedArrayBuffer).
  return new TextEncoder().encode(userId).slice();
}

export function transportsToString(transports?: string[]): string | null {
  return transports && transports.length > 0 ? transports.join(',') : null;
}

export function transportsFromString(value: string | null | undefined): string[] | undefined {
  return value ? value.split(',') : undefined;
}
