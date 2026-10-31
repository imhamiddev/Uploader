export type FileStatus = "processing" | "ready" | "failed"

export interface FileRecord {
  id: string
  /** Public share token; null once the link is revoked. */
  token: string | null
  /** Download name (what the visitor receives). */
  name: string
  /** Name used inside the ZIP / stored name. */
  originalName: string
  size: number
  createdAt: number
  expiresAt: number | null
  /** scrypt hash of the link password ("salt:hash") or null. */
  pw: string | null
  zipped: boolean
  zipEncrypted: boolean
  status: FileStatus
  error?: string
  revoked: boolean
  downloads: number
  /** File name inside the files directory once processed. */
  file: string | null
}

export interface UploadRecord {
  id: string
  size: number
  name: string
  last: number
}

export interface Database {
  files: Record<string, FileRecord>
  uploads: Record<string, UploadRecord>
}

/** Shape returned to the admin UI by GET /api/files. */
export interface FileView {
  id: string
  name: string
  size: number
  createdAt: number
  expiresAt: number | null
  hasPassword: boolean
  zipped: boolean
  zipEncrypted: boolean
  status: FileStatus
  error: string | null
  downloads: number
  link: string | null
}

export interface FilesResponse {
  files: FileView[]
  used: number
  quota: number
}
