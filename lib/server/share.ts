import { DOWNLOAD_TTL_MS } from "./config"
import { deleteRecord, getDb, isExpired } from "./db"
import { cookiesOf, setCookie } from "./auth"
import { makeToken, readToken } from "./security"
import type { FileRecord } from "./types"
import type { NextResponse } from "next/server"

export function findByToken(token: string | null | undefined): FileRecord | null {
  if (!token) return null
  for (const r of Object.values(getDb().files)) {
    if (r.token && r.token === token && !r.revoked) return r
  }
  return null
}

/** A record that is ready, not revoked and not expired (expired ones are purged). */
export function liveRecord(token: string): FileRecord | null {
  const r = findByToken(token)
  if (!r || r.status !== "ready") return null
  if (isExpired(r)) {
    void deleteRecord(r)
    return null
  }
  return r
}

const dlCookie = (token: string) => "dl_" + token

/** Issues the short-lived cookie that unlocks a password-protected download. */
export function grantDownload(req: Request, res: NextResponse, token: string): void {
  setCookie(
    req,
    res,
    dlCookie(token),
    makeToken({ t: "dl", k: token, exp: Date.now() + DOWNLOAD_TTL_MS }),
    DOWNLOAD_TTL_MS,
    "/d/" + token
  )
}

export function hasDownloadGrant(req: Request, token: string): boolean {
  const t = readToken<{ exp: number; k?: string }>(cookiesOf(req)[dlCookie(token)])
  return !!t && t.k === token
}
