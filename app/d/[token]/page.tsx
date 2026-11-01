import {
  ClockIcon,
  DownloadIcon,
  FileArchiveIcon,
  FileIcon,
  LinkIcon,
} from "lucide-react"
import type { Metadata } from "next"

import { PasswordGate } from "@/components/download/password-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { formatDateTime, formatSize } from "@/lib/client/format"
import { getDb, isExpired } from "@/lib/server/db"
import { findByToken } from "@/lib/server/share"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "دانلود فایل" }

type Params = { params: Promise<{ token: string }> }

function Unavailable({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Empty className="max-w-sm">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LinkIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </main>
  )
}

export default async function DownloadPage({ params }: Params) {
  const { token } = await params
  void getDb()
  const r = findByToken(token)

  if (!r || isExpired(r) || r.status === "failed") {
    return (
      <Unavailable
        title="لینک معتبر نیست"
        description="این لینک منقضی شده، حذف شده یا از دسترس خارج شده است."
      />
    )
  }
  if (r.status === "processing") {
    return (
      <Unavailable
        title="فایل در حال آماده‌سازی است"
        description="چند لحظه بعد صفحه را دوباره بارگذاری کنید."
      />
    )
  }

  const Icon = r.zipped ? FileArchiveIcon : FileIcon

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-14 items-center justify-center rounded-2xl bg-muted">
            <Icon className="size-7" aria-hidden="true" />
          </div>
          <CardTitle dir="auto" className="break-all text-base">
            {r.name}
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center justify-center gap-1.5">
            <span>{formatSize(r.size)}</span>
            {r.zipped && <Badge variant="secondary">ZIP</Badge>}
            {r.zipEncrypted && <Badge variant="outline">رمزگذاری‌شده</Badge>}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {r.expiresAt && (
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ClockIcon className="size-3.5" aria-hidden="true" />
              انقضا: {formatDateTime(r.expiresAt)}
            </p>
          )}
          {r.pw ? (
            <PasswordGate token={token} />
          ) : (
            <Button
              size="lg"
              className="w-full"
              nativeButton={false}
              render={<a href={`/d/${token}/file`} download />}
            >
              <DownloadIcon data-icon="inline-start" aria-hidden="true" />
              دانلود فایل
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
