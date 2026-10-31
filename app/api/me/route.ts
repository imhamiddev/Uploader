import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/server/auth"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied
  return NextResponse.json({ ok: true })
}
