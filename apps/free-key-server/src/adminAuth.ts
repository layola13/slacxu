import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

export function verifyAdminPasswordHash(password: string, encoded: string): boolean {
  const [algorithm, salt, hexHash] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !hexHash || !/^[a-f0-9]+$/i.test(hexHash)) return false;
  try {
    const expected = Buffer.from(hexHash, "hex");
    if (expected.length < 32) return false;
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createAdminSession(username: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ username, exp: now + 8 * 60 * 60_000 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readAdminSession(token: string, secret: string, now = Date.now()): { username: string } | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { username?: unknown; exp?: unknown };
    return typeof value.username === "string" && typeof value.exp === "number" && value.exp > now ? { username: value.username } : null;
  } catch {
    return null;
  }
}
