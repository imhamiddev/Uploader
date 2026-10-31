import { NextResponse } from "next/server"

import { setAdminSession } from "@/lib/server/auth"
import { getConfig } from "@/lib/server/config"
import { clientIp, jsonError, readJson } from "@/lib/server/http"
import { addFail, clearFails, isLimited } from "@/lib/server/rate-limit"
import { safeEq } from "@/lib/server/security"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const key = "login:" + clientIp(req)
  if (isLimited(key)) {
    return jsonError("تلاش‌های زیاد. ۱۵ دقیقه بعد دوباره امتحان کنید.", 429)
  }

  const { username, password } = await readJson<{
    username?: string
    password?: string
  }>(req)
  const cfg = getConfig()
  // Evaluate both comparisons (no short-circuit) to keep timing uniform.
  const userOk = safeEq(username || "", cfg.adminUser)
  const passOk = safeEq(password || "", cfg.adminPass)
  if (!(userOk && passOk)) {
    addFail(key)
    return jsonError("نام کاربری یا رمز اشتباه است.", 401)
  }

  clearFails(key)
  const res = NextResponse.json({ ok: true })
  setAdminSession(req, res)
  return res
}
