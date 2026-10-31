import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { SESSION_TTL_MS, getConfig } from "./config"
import { isSecure } from "./http"
import { makeToken, readToken } from "./security"

export const SESSION_COOKIE = "sid"

function parseCookies(header: string | null): Record<string, string> {
  const o: Record<string, string> = {}
  ;(header || "").split(";").forEach((c) => {
    const i = c.indexOf("=")
    if (i > 0) {
      try {
        o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim())
      } catch {
        /* ignore malformed cookie */
      }
    }
  })
  return o
}

export const cookiesOf = (req: Request) => parseCookies(req.headers.get("cookie"))

function validAdminToken(token: string | undefined): boolean {
  const t = readToken<{ exp: number; t?: string; u?: string }>(token)
  return !!(t && t.t === "admin" && t.u === getConfig().adminUser)
}

/** For API route handlers. */
export const isAdmin = (req: Request): boolean =>
  validAdminToken(cookiesOf(req)[SESSION_COOKIE])

/** For Server Components (the admin page decides login vs dashboard). */
export async function isAdminSession(): Promise<boolean> {
  const store = await cookies()
  return validAdminToken(store.get(SESSION_COOKIE)?.value)
}

/** Returns a 401 response when the request is not authenticated. */
export function requireAdmin(req: Request): NextResponse | null {
  return isAdmin(req)
    ? null
    : NextResponse.json({ error: "unauthorized" }, { status: 401 })
}

export function setCookie(
  req: Request,
  res: NextResponse,
  name: string,
  value: string,
  maxAgeMs: number,
  path = "/"
): void {
  res.cookies.set(name, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: isSecure(req),
    maxAge: Math.floor(maxAgeMs / 1000),
    path,
  })
}

export function setAdminSession(req: Request, res: NextResponse): void {
  const token = makeToken({
    t: "admin",
    u: getConfig().adminUser,
    exp: Date.now() + SESSION_TTL_MS,
  })
  setCookie(req, res, SESSION_COOKIE, token, SESSION_TTL_MS)
}
