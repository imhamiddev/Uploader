"use client"

import {
  ClockIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  FileArchiveIcon,
  FileAudioIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FileVideoIcon,
  LinkIcon,
  LockIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CopyButton } from "@/components/ui/copy-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  faNum,
  formatDateTime,
  formatSize,
  kindOf,
  type FileKind,
} from "@/lib/client/format"
import type { FileView } from "@/lib/server/types"
import { useTimeAgo } from "@/hooks/use-time-ago"

const ICONS: Record<FileKind, typeof FileIcon> = {
  image: FileImageIcon,
  video: FileVideoIcon,
  audio: FileAudioIcon,
  archive: FileArchiveIcon,
  document: FileTextIcon,
  file: FileIcon,
}

export type FileAction = "edit" | "delete" | "revoke" | "regenerate"

interface FileRowProps {
  file: FileView
  onAction: (action: FileAction, file: FileView) => void
}

function ExpiryBadge({ expiresAt }: { expiresAt: number | null }) {
  const left = useTimeAgo(expiresAt ?? 0)
  if (!expiresAt) return <Badge variant="outline">بدون انقضا</Badge>
  return (
    <Badge variant="secondary">
      <ClockIcon data-icon="inline-start" aria-hidden="true" />
      {left}
    </Badge>
  )
}

export function FileRow({ file, onAction }: FileRowProps) {
  const Icon = file.zipped ? FileArchiveIcon : ICONS[kindOf(file.name)]
  const ready = file.status === "ready"
  const absoluteLink = file.link
    ? () => `${window.location.origin}${file.link}`
    : ""

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        {file.status === "processing" ? (
          <Spinner />
        ) : (
          <Icon aria-hidden="true" />
        )}
      </ItemMedia>

      <ItemContent>
        <ItemTitle dir="auto" className="break-all">
          {file.name}
        </ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-1.5">
          <span>{formatSize(file.size)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDateTime(file.createdAt)}</span>
        </ItemDescription>

        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {file.status === "processing" && (
            <Badge variant="secondary">در حال پردازش…</Badge>
          )}
          {file.status === "failed" && (
            <Badge variant="destructive">
              ناموفق{file.error ? `: ${file.error}` : ""}
            </Badge>
          )}
          {ready && <ExpiryBadge expiresAt={file.expiresAt} />}
          {file.hasPassword && (
            <Badge variant="outline">
              <LockIcon data-icon="inline-start" aria-hidden="true" />
              رمزدار
            </Badge>
          )}
          {file.zipped && (
            <Badge variant="outline">
              {file.zipEncrypted ? "ZIP رمزگذاری‌شده" : "ZIP"}
            </Badge>
          )}
          {ready && !file.link && <Badge variant="destructive">لینک لغو شد</Badge>}
          {ready && (
            <Badge variant="outline">
              <DownloadIcon data-icon="inline-start" aria-hidden="true" />
              {faNum(file.downloads)} دانلود
            </Badge>
          )}
        </div>
        {file.status === "processing" && (
          <Progress value={null} aria-label="در حال پردازش" className="mt-2" />
        )}
      </ItemContent>

      <ItemActions>
        {file.link && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="باز کردن لینک"
                    nativeButton={false}
                    render={
                      <a href={file.link} target="_blank" rel="noopener" />
                    }
                  />
                }
              >
                <LinkIcon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>باز کردن لینک</TooltipContent>
            </Tooltip>
            <CopyButton text={absoluteLink} label="کپی لینک" variant="ghost" />
          </>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="گزینه‌های بیشتر" />
            }
          >
            <EllipsisVerticalIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {ready && (
              <DropdownMenuItem onClick={() => onAction("edit", file)}>
                <PencilIcon aria-hidden="true" />
                ویرایش
              </DropdownMenuItem>
            )}
            {ready && (
              <DropdownMenuItem onClick={() => onAction("regenerate", file)}>
                <RefreshCwIcon aria-hidden="true" />
                لینک جدید
              </DropdownMenuItem>
            )}
            {ready && file.link && (
              <DropdownMenuItem onClick={() => onAction("revoke", file)}>
                <UnlinkIcon aria-hidden="true" />
                لغو لینک
              </DropdownMenuItem>
            )}
            {ready && <DropdownMenuSeparator />}
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onAction("delete", file)}
            >
              <Trash2Icon aria-hidden="true" />
              حذف
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  )
}
