export class ApiError extends Error {
  status: number
  fatal: boolean

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
    // 4xx errors will not succeed on retry.
    this.fatal = status >= 400 && status < 500
  }
}

let unauthorizedHandler: (() => void) | null = null

/** The dashboard registers a callback that returns the user to the login page. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn
}

export const SESSION_EXPIRED = "نشست منقضی شد. دوباره وارد شوید."

export async function api<T = Record<string, unknown>>(
  url: string,
  { method = "GET", json }: { method?: string; json?: unknown } = {}
): Promise<T> {
  const r = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: json ? { "Content-Type": "application/json" } : {},
    body: json ? JSON.stringify(json) : undefined,
  })

  if (r.status === 401 && url !== "/api/login") {
    unauthorizedHandler?.()
    throw new ApiError(SESSION_EXPIRED, 401)
  }

  const data = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok) throw new ApiError(data.error || "خطا " + r.status, r.status)
  return data as T
}
