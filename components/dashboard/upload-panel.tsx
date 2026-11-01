"use client"

import {
  CircleAlertIcon,
  FileIcon,
  FileUpIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"
import * as React from "react"

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { toastManager } from "@/components/ui/toast"
import { faNum, formatSize } from "@/lib/client/format"
import { uploadOne } from "@/lib/client/upload"
import { cn } from "@/lib/utils"

import {
  ExpiryPicker,
  INITIAL_EXPIRY,
  resolveExpiry,
  type ExpiryState,
} from "./expiry-picker"

type ItemState = "idle" | "uploading" | "processing" | "error" | "done"

interface QueueItem {
  key: string
  file: File
  name: string
  state: ItemState
  progress: number
  error?: string
}

interface UploadPanelProps {
  quotaLeft: number
  onUploaded: () => void
}

let seq = 0

export function UploadPanel({ quotaLeft, onUploaded }: UploadPanelProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [queue, setQueue] = React.useState<QueueItem[]>([])
  const [busy, setBusy] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)

  const [password, setPassword] = React.useState("")
  const [zip, setZip] = React.useState(false)
  const [zipPassword, setZipPassword] = React.useState("")
  const [rename, setRename] = React.useState(false)
  const [expiry, setExpiry] = React.useState<ExpiryState>(INITIAL_EXPIRY)

  const patch = (key: string, p: Partial<QueueItem>) =>
    setQueue((q) => q.map((i) => (i.key === key ? { ...i, ...p } : i)))

  function addFiles(list: FileList | File[]) {
    const items = Array.from(list).map<QueueItem>((file) => ({
      key: "f" + ++seq,
      file,
      name: file.name,
      state: "idle",
      progress: 0,
    }))
    setQueue((q) => [...q, ...items])
  }

  const pending = queue.filter((i) => i.state === "idle" || i.state === "error")
  const totalSize = pending.reduce((n, i) => n + i.file.size, 0)

  async function start() {
    const expiresAt = resolveExpiry(expiry)
    if (expiresAt === "invalid") {
      toastManager.add({
        title: "زمان انقضا نامعتبر است",
        description: "یک تاریخ و ساعت در آینده انتخاب کنید.",
        type: "error",
      })
      return
    }
    if (totalSize > quotaLeft) {
      toastManager.add({
        title: "فضای کافی نیست",
        description: `${formatSize(totalSize)} لازم است، ${formatSize(quotaLeft)} باقی مانده.`,
        type: "error",
      })
      return
    }

    setBusy(true)
    let ok = 0
    for (const item of pending) {
      patch(item.key, { state: "uploading", progress: 0, error: undefined })
      try {
        await uploadOne(
          item.file,
          {
            password,
            zip,
            zipPassword,
            expiresAt,
            rename,
            name: rename ? item.name : "",
          },
          (f) => patch(item.key, { progress: f })
        )
        patch(item.key, { state: "done", progress: 1 })
        ok++
      } catch (e) {
        patch(item.key, { state: "error", error: (e as Error).message })
      }
    }
    setBusy(false)
    onUploaded()
    if (ok) {
      toastManager.add({
        title: `${faNum(ok)} فایل آپلود شد`,
        description: "لینک اشتراک‌گذاری در فهرست فایل‌ها آماده است.",
        type: "success",
      })
      setQueue((q) => q.filter((i) => i.state !== "done"))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>آپلود فایل</CardTitle>
        <CardDescription>
          فایل‌ها در بخش‌های ۵ مگابایتی ارسال می‌شوند و با قطع اتصال ادامه پیدا
          می‌کنند.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ""
          }}
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
            dragging && "border-primary bg-muted/60"
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <FileUpIcon className="size-5" aria-hidden="true" />
          </span>
          <span className="font-medium">فایل را اینجا رها کنید یا بزنید</span>
          <span className="text-xs text-muted-foreground">
            انتخاب چند فایل همزمان پشتیبانی می‌شود
          </span>
        </button>

        {queue.length > 0 && (
          <div className="flex flex-col gap-2">
            {queue.map((item) => (
              <Attachment
                key={item.key}
                state={item.state}
                className="w-full"
              >
                <AttachmentMedia>
                  {item.state === "uploading" || item.state === "processing" ? (
                    <Spinner />
                  ) : item.state === "error" ? (
                    <CircleAlertIcon aria-hidden="true" />
                  ) : (
                    <FileIcon aria-hidden="true" />
                  )}
                </AttachmentMedia>
                <AttachmentContent className="flex-1">
                  <AttachmentTitle dir="auto">{item.name}</AttachmentTitle>
                  <AttachmentDescription>
                    {item.state === "error"
                      ? item.error
                      : item.state === "uploading"
                        ? `${faNum(item.progress * 100)}٪ از ${formatSize(item.file.size)}`
                        : formatSize(item.file.size)}
                  </AttachmentDescription>
                  {item.state === "uploading" && (
                    <Progress
                      value={item.progress * 100}
                      aria-label="پیشرفت آپلود"
                    />
                  )}
                </AttachmentContent>
                {!busy && (
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label="حذف از صف"
                      onClick={() =>
                        setQueue((q) => q.filter((i) => i.key !== item.key))
                      }
                    >
                      <XIcon aria-hidden="true" />
                    </AttachmentAction>
                  </AttachmentActions>
                )}
              </Attachment>
            ))}
          </div>
        )}

        <Separator />

        <FieldGroup>
          <Field>
            <FieldLabel>رمز لینک دانلود (اختیاری)</FieldLabel>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="بدون رمز"
              autoComplete="new-password"
              disabled={busy}
            />
            <FieldDescription>
              بازدیدکننده قبل از دانلود باید این رمز را وارد کند.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>زمان انقضای لینک</FieldLabel>
            <ExpiryPicker value={expiry} onChange={setExpiry} disabled={busy} />
          </Field>

          <Field orientation="horizontal">
            <div className="flex flex-col gap-0.5">
              <FieldLabel>فشرده‌سازی ZIP</FieldLabel>
              <FieldDescription>
                فایل قبل از اشتراک‌گذاری در یک آرشیو ZIP قرار می‌گیرد.
              </FieldDescription>
            </div>
            <Switch checked={zip} onCheckedChange={setZip} disabled={busy} />
          </Field>

          {zip && (
            <Field>
              <FieldLabel>رمز داخل ZIP (اختیاری)</FieldLabel>
              <PasswordInput
                value={zipPassword}
                onChange={(e) => setZipPassword(e.target.value)}
                placeholder="بدون رمز"
                autoComplete="new-password"
                disabled={busy}
              />
              <FieldDescription>
                محتوای آرشیو با AES-256 رمزگذاری می‌شود و مستقل از رمز لینک است.
              </FieldDescription>
            </Field>
          )}

          <Field orientation="horizontal">
            <div className="flex flex-col gap-0.5">
              <FieldLabel>انتخاب نام دلخواه</FieldLabel>
              <FieldDescription>
                خاموش: برای هر فایل یک نام عددی تصادفی ساخته می‌شود.
              </FieldDescription>
            </div>
            <Switch checked={rename} onCheckedChange={setRename} disabled={busy} />
          </Field>

          {rename && pending.length > 0 && (
            <div className="flex flex-col gap-2">
              {pending.map((item) => (
                <Field key={item.key}>
                  <FieldLabel>نام برای «{item.file.name}»</FieldLabel>
                  <Input
                    dir="auto"
                    value={item.name}
                    onChange={(e) => patch(item.key, { name: e.target.value })}
                    disabled={busy}
                  />
                </Field>
              ))}
            </div>
          )}
        </FieldGroup>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="lg"
            onClick={start}
            loading={busy}
            disabled={pending.length === 0}
          >
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            شروع آپلود
            {pending.length > 0 && ` (${faNum(pending.length)})`}
          </Button>
          {pending.length > 0 && (
            <span className="text-xs text-muted-foreground">
              مجموع {formatSize(totalSize)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
