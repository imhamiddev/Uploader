import { formatDate, toPersianDigits } from "@/lib/persian-date"

export const faNum = (n: number, maxFractionDigits = 0): string =>
  Number(n).toLocaleString("fa-IR", { maximumFractionDigits: maxFractionDigits })

const UNITS = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت", "ترابایت"]

export function formatSize(bytes: number): string {
  let b = bytes
  let i = 0
  while (b >= 1024 && i < UNITS.length - 1) {
    b /= 1024
    i++
  }
  return faNum(b, i ? (b < 10 ? 2 : 1) : 0) + " " + UNITS[i]
}

/** Shamsi date + time, e.g. «۱۴ آبان ۱۴۰۵، ۱۶:۳۰». */
export function formatDateTime(ms: number): string {
  return toPersianDigits(formatDate(new Date(ms), "d MMMM yyyy، HH:mm"))
}

export type FileKind = "image" | "video" | "audio" | "archive" | "document" | "file"

export function kindOf(name: string): FileKind {
  const e = (name.split(".").pop() || "").toLowerCase()
  if (/^(png|jpe?g|gif|webp|svg|avif|bmp|heic|tiff?)$/.test(e)) return "image"
  if (/^(mp4|mkv|mov|avi|webm|m4v|wmv)$/.test(e)) return "video"
  if (/^(mp3|wav|flac|m4a|ogg|aac|opus)$/.test(e)) return "audio"
  if (/^(zip|rar|7z|tar|gz|tgz|bz2|xz)$/.test(e)) return "archive"
  if (/^(txt|md|pdf|docx?|xlsx?|pptx?|csv|rtf|json|log)$/.test(e)) return "document"
  return "file"
}
