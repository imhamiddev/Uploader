import { NextResponse } from "next/server"

export const jsonError = (error: string, status: number) =>
  NextResponse.json({ error }, { status })

/** Client IP behind cPanel / LiteSpeed / Passenger proxies. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim()
  return req.headers.get("x-real-ip") ?? "unknown"
}

export function isSecure(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto")
  if (proto) return proto.split(",")[0].trim() === "https"
  return new URL(req.url).protocol === "https:"
}

/** Safe JSON body reader with a size cap (default 10 KB). */
export async function readJson<T = Record<string, unknown>>(
  req: Request,
  limit = 10 * 1024
): Promise<T> {
  const text = await req.text()
  if (text.length > limit) throw new Error("payload too large")
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    return {} as T
  }
}

/** Route handler context for dynamic segments (params is a Promise in Next 16). */
export type RouteCtx<K extends string> = { params: Promise<Record<K, string>> }
