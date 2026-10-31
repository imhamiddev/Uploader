import { NextResponse } from "next/server"

import { SESSION_COOKIE } from "@/lib/server/auth"

export const dynamic = "force-dynamic"

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete({ name: SESSION_COOKIE, path: "/" })
  return res
}
