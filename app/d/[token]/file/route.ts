import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

import { getConfig } from "@/lib/server/config"
import { save } from "@/lib/server/db"
import type { RouteCtx } from "@/lib/server/http"
import { hasDownloadGrant, liveRecord } from "@/lib/server/share"

export const dynamic = "force-dynamic"

const redirect = (to: string) =>
  new Response(null, { status: 303, headers: { Location: to } })

/** RFC 6266 / 5987 Content-Disposition with a safe ASCII fallback. */
function disposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** Parses a single `bytes=a-b` range. Returns null when unsatisfiable. */
function parseRange(header: string, size: number): [number, number] | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  let start: number
  let end: number
  if (m[1] === "" && m[2] === "") return null
  if (m[1] === "") {
    const suffix = Number(m[2])
    if (!suffix) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start > end || start >= size) return null
  return [start, end]
}

export async function GET(req: Request, { params }: RouteCtx<"token">) {
  const { token } = await params
  const r = liveRecord(token)
  if (!r || !r.file) return redirect(`/d/${token}`)
  if (r.pw && !hasDownloadGrant(req, token)) return redirect(`/d/${token}`)

  const filePath = path.join(getConfig().filesDir, r.file)
  const stat = await fsp.stat(filePath).catch(() => null)
  if (!stat) return redirect(`/d/${token}`)

  const rangeHeader = req.headers.get("range")
  const headers: Record<string, string> = {
    "Content-Type": r.zipped ? "application/zip" : "application/octet-stream",
    "Content-Disposition": disposition(r.name),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  }

  let start = 0
  let end = stat.size - 1
  let status = 200
  if (rangeHeader) {
    const range = parseRange(rangeHeader, stat.size)
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      })
    }
    ;[start, end] = range
    status = 206
    headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`
  }

  // Count a download once: whole-file requests and the first range request.
  if (!rangeHeader || /^bytes=0-/.test(rangeHeader)) {
    r.downloads++
    void save()
  }

  headers["Content-Length"] = String(stat.size === 0 ? 0 : end - start + 1)
  if (stat.size === 0) return new Response(null, { status: 200, headers })

  const stream = Readable.toWeb(
    fs.createReadStream(filePath, { start, end })
  ) as ReadableStream<Uint8Array>
  return new Response(stream, { status, headers })
}
