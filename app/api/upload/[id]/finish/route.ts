import fsp from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/server/auth"
import { getConfig } from "@/lib/server/config"
import { getDb, save } from "@/lib/server/db"
import { jsonError, readJson, type RouteCtx } from "@/lib/server/http"
import { processUpload } from "@/lib/server/process-upload"
import {
  cleanName,
  hashPw,
  newLinkToken,
  randomDigits,
} from "@/lib/server/security"
import type { FileRecord } from "@/lib/server/types"

export const dynamic = "force-dynamic"

interface FinishBody {
  name?: string
  rename?: boolean
  zip?: boolean
  zipPassword?: string
  password?: string
  expiresAt?: number | null
}

export async function POST(req: Request, { params }: RouteCtx<"id">) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const { id } = await params
  const db = getDb()
  const u = db.uploads[id]
  if (!u) return jsonError("آپلود پیدا نشد.", 404)

  const tmpPath = path.join(getConfig().tmpDir, u.id + ".part")
  const st = await fsp.stat(tmpPath).catch(() => null)
  if (!st || st.size !== u.size) return jsonError("فایل ناقص دریافت شد.", 400)

  const b = await readJson<FinishBody>(req)

  let expiresAt: number | null = null
  if (b.expiresAt != null) {
    expiresAt = Number(b.expiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return jsonError("زمان انقضا نامعتبر است.", 400)
    }
  }

  // Name switch: on -> user-supplied name; off -> a random numeric name is
  // generated server-side regardless of what the client sent.
  const renameOn = !!b.rename
  const ext = (u.name.match(/\.[^./\\]+$/) || [""])[0]
  const baseName = renameOn
    ? cleanName(b.name, u.name)
    : randomDigits(10) + ext
  const zipped = !!b.zip
  const downloadName = zipped
    ? (baseName.replace(/\.[^.]*$/, "") || baseName) + ".zip"
    : baseName

  // Link password (gates the download page) vs zip content password
  // (AES-256 inside the archive): independent, either or both may be set.
  const linkPassword = b.password ? String(b.password) : ""
  const zipPassword = zipped && b.zipPassword ? String(b.zipPassword) : ""

  const rec: FileRecord = {
    id: u.id,
    token: newLinkToken(),
    name: downloadName,
    originalName: baseName,
    size: u.size,
    createdAt: Date.now(),
    expiresAt,
    pw: linkPassword ? hashPw(linkPassword) : null,
    zipped,
    zipEncrypted: !!zipPassword,
    status: "processing",
    revoked: false,
    downloads: 0,
    file: null,
  }
  db.files[rec.id] = rec
  delete db.uploads[u.id]
  await save()

  // Respond immediately; the UI polls the status while we zip / move.
  void processUpload(rec, tmpPath, baseName, zipPassword)
  return NextResponse.json({ ok: true, id: rec.id })
}
