import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/server/auth"
import { getConfig } from "@/lib/server/config"
import { getDb, usedBytes } from "@/lib/server/db"
import type { FilesResponse } from "@/lib/server/types"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const files = Object.values(getDb().files)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      id: r.id,
      name: r.name,
      size: r.size,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      hasPassword: !!r.pw,
      zipped: r.zipped,
      zipEncrypted: !!r.zipEncrypted,
      status: r.status,
      error: r.error || null,
      downloads: r.downloads,
      link: r.token && !r.revoked ? "/d/" + r.token : null,
    }))

  const body: FilesResponse = { files, used: usedBytes(), quota: getConfig().quota }
  return NextResponse.json(body)
}
