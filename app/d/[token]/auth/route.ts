import { NextResponse } from "next/server"

import { clientIp, jsonError, readJson, type RouteCtx } from "@/lib/server/http"
import { addFail, clearFails, isLimited } from "@/lib/server/rate-limit"
import { checkPw } from "@/lib/server/security"
import { grantDownload, liveRecord } from "@/lib/server/share"

export const dynamic = "force-dynamic"

/** Verifies the link password and unlocks the download for ten minutes. */
export async function POST(req: Request, { params }: RouteCtx<"token">) {
  const { token } = await params
  const r = liveRecord(token)
  if (!r) return jsonError("این لینک معتبر نیست.", 404)

  const res = NextResponse.json({ ok: true, file: `/d/${token}/file` })
  if (!r.pw) return res

  const key = `dl:${token}:${clientIp(req)}`
  if (isLimited(key)) {
    return jsonError("تلاش‌های زیاد. چند دقیقه بعد دوباره امتحان کنید.", 429)
  }

  const { password } = await readJson<{ password?: string }>(req)
  if (!checkPw(password || "", r.pw)) {
    addFail(key)
    return jsonError("رمز اشتباه است.", 401)
  }

  clearFails(key)
  grantDownload(req, res, token)
  return res
}
