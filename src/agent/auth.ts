import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const SESSION_COOKIE_NAME = "ddraft_session";

export interface SessionPayload {
  iat: number;
  exp: number;
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64url(str: string): Buffer {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  return Buffer.from(base64, "base64");
}

export function createSessionToken(secret: string, ttlSeconds = SESSION_TTL_SECONDS): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    iat: now,
    exp: now + ttlSeconds
  };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  const sigB64 = base64url(sig);
  return `${payloadB64}.${sigB64}`;
}

export function verifySessionToken(token: string | undefined | null, secret: string): boolean {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;

  try {
    const expectedSig = createHmac("sha256", secret).update(payloadB64).digest();
    const actualSig = fromBase64url(sigB64);

    if (expectedSig.length !== actualSig.length) return false;
    if (!timingSafeEqual(expectedSig, actualSig)) return false;

    const json = JSON.parse(fromBase64url(payloadB64).toString("utf8")) as SessionPayload;
    if (typeof json.exp !== "number") return false;
    const now = Math.floor(Date.now() / 1000);
    return json.exp > now;
  } catch {
    return false;
  }
}

export function parseCookie(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1].trim()) : undefined;
}

export function buildSessionCookie(token: string, maxAge = SESSION_TTL_SECONDS, isSecure = false): string {
  const secureFlag = isSecure ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`;
}

export function buildClearCookie(isSecure = false): string {
  const secureFlag = isSecure ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
}
