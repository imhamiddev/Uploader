import crypto from "node:crypto"

import { getConfig } from "./config"

const sha = (s: unknown) => crypto.createHash("sha256").update(String(s)).digest()

/** Constant-time string comparison (hashes both sides first). */
export const safeEq = (a: unknown, b: unknown): boolean =>
  crypto.timingSafeEqual(sha(a), sha(b))

const sign = (v: string) =>
  crypto.createHmac("sha256", getConfig().secret).update(v).digest("base64url")

export interface TokenPayload {
  exp: number
  [key: string]: unknown
}

export function makeToken(payload: TokenPayload): string {
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return p + "." + sign(p)
}

export function readToken<T extends TokenPayload = TokenPayload>(
  t: string | undefined | null
): T | null {
  if (!t || typeof t !== "string") return null
  const [p, s] = t.split(".")
  if (!p || !s) return null
  const e = sign(p)
  if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) {
    return null
  }
  try {
    const o = JSON.parse(Buffer.from(p, "base64url").toString()) as T
    return o.exp > Date.now() ? o : null
  } catch {
    return null
  }
}

export function hashPw(pw: string): string {
  const salt = crypto.randomBytes(16)
  return salt.toString("hex") + ":" + crypto.scryptSync(pw, salt, 32).toString("hex")
}

export function checkPw(pw: unknown, stored: string): boolean {
  const [s, h] = stored.split(":")
  const x = crypto.scryptSync(String(pw), Buffer.from(s, "hex"), 32)
  return crypto.timingSafeEqual(x, Buffer.from(h, "hex"))
}

export function cleanName(n: unknown, fallback: string): string {
  const cleaned = String(n || "")
    .replace(/[\\/\0\r\n:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 200)
  return cleaned || fallback
}

export const randomDigits = (n = 8): string =>
  Array.from({ length: n }, () => crypto.randomInt(0, 10)).join("")

export const newId = (): string => crypto.randomBytes(9).toString("hex")
export const newLinkToken = (): string => crypto.randomBytes(18).toString("base64url")
