"use client"

import { FolderOpenIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"

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
import { ItemGroup } from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { toastManager } from "@/components/ui/toast"
import { api, setUnauthorizedHandler } from "@/lib/client/api"
import { faNum } from "@/lib/client/format"
import type { FilesResponse, FileView } from "@/lib/server/types"

import { AppHeader } from "./app-header"
import { ConfirmDialog } from "./confirm-dialog"
import { EditDialog, type EditPatch } from "./edit-dialog"
import { FileRow, type FileAction } from "./file-row"
import { UploadPanel } from "./upload-panel"

type Pending = { action: "delete" | "revoke" | "regenerate"; file: FileView }

const CONFIRM: Record<
  Pending["action"],
  { title: string; description: string; label: string; destructive: boolean }
> = {
  delete: {
    title: "حذف فایل؟",
    description: "فایل و لینک آن برای همیشه حذف می‌شود و قابل بازگشت نیست.",
    label: "حذف",
    destructive: true,
  },
  revoke: {
    title: "لغو لینک؟",
    description: "لینک فعلی از کار می‌افتد. فایل می‌ماند و می‌توانید لینک جدید بسازید.",
    label: "لغو لینک",
    destructive: true,
  },
  regenerate: {
    title: "ساخت لینک جدید؟",
    description: "لینک قبلی از کار می‌افتد و یک لینک تازه ساخته می‌شود.",
    label: "ساخت لینک",
    destructive: false,
  },
}

export function Dashboard() {
  const router = useRouter()
  const [data, setData] = React.useState<FilesResponse | null>(null)
  const [pending, setPending] = React.useState<Pending | null>(null)
  const [editing, setEditing] = React.useState<FileView | null>(null)

  const toLogin = React.useCallback(() => router.refresh(), [router])

  React.useEffect(() => {
    setUnauthorizedHandler(toLogin)
    window.addEventListener("uploader:unauthorized", toLogin)
    return () => {
      setUnauthorizedHandler(null)
      window.removeEventListener("uploader:unauthorized", toLogin)
    }
  }, [toLogin])

  const load = React.useCallback(async () => {
    try {
      setData(await api<FilesResponse>("/api/files"))
    } catch {
      /* 401 is handled globally; transient errors retry on the next poll */
    }
  }, [])

  const processing = data?.files.some((f) => f.status === "processing") ?? false

  React.useEffect(() => {
    void load()
    const t = setInterval(load, processing ? 2000 : 30000)
    return () => clearInterval(t)
  }, [load, processing])

  const fail = (e: unknown) =>
    toastManager.add({
      title: "خطا",
      description: (e as Error).message,
      type: "error",
    })

  async function run(action: Pending["action"], file: FileView) {
    try {
      if (action === "delete") {
        await api(`/api/files/${file.id}`, { method: "DELETE" })
        toastManager.add({ title: "فایل حذف شد", type: "success" })
      } else if (action === "revoke") {
        await api(`/api/files/${file.id}/revoke`, { method: "POST" })
        toastManager.add({ title: "لینک لغو شد", type: "success" })
      } else {
        await api(`/api/files/${file.id}/regenerate`, { method: "POST" })
        toastManager.add({ title: "لینک جدید ساخته شد", type: "success" })
      }
      await load()
    } catch (e) {
      fail(e)
    }
  }

  async function save(file: FileView, patch: EditPatch) {
    await api(`/api/files/${file.id}`, { method: "PATCH", json: patch })
    toastManager.add({ title: "تغییرات ذخیره شد", type: "success" })
    await load()
  }

  function onAction(action: FileAction, file: FileView) {
    if (action === "edit") setEditing(file)
    else setPending({ action, file })
  }

  async function logout() {
    await api("/api/logout", { method: "POST" }).catch(() => {})
    router.refresh()
  }

  const used = data?.used ?? 0
  const quota = data?.quota ?? 0
  const confirm = pending ? CONFIRM[pending.action] : null

  return (
    <div className="min-h-dvh bg-muted/30">
      <AppHeader used={used} quota={quota} onLogout={logout} />

      <main className="mx-auto grid w-full max-w-5xl gap-4 p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <UploadPanel quotaLeft={Math.max(0, quota - used)} onUploaded={load} />

        <Card>
          <CardHeader>
            <CardTitle>فایل‌های من</CardTitle>
            <CardDescription>
              {data ? `${faNum(data.files.length)} فایل` : "در حال بارگذاری…"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!data ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : data.files.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FolderOpenIcon aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>هنوز فایلی آپلود نشده</EmptyTitle>
                  <EmptyDescription>
                    اولین فایل خود را از پنل آپلود اضافه کنید.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ItemGroup className="gap-2">
                {data.files.map((f) => (
                  <FileRow key={f.id} file={f} onAction={onAction} />
                ))}
              </ItemGroup>
            )}
          </CardContent>
        </Card>
      </main>

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        confirmLabel={confirm?.label ?? ""}
        destructive={confirm?.destructive}
        onConfirm={() => {
          if (pending) void run(pending.action, pending.file)
          setPending(null)
        }}
      />
      <EditDialog
        file={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSave={save}
      />
    </div>
  )
}
