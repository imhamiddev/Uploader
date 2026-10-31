interface Fail {
  n: number
  until: number
}

const g = globalThis as typeof globalThis & { __uploaderFails?: Map<string, Fail> }
const fails = (g.__uploaderFails ??= new Map<string, Fail>())

const MAX_ATTEMPTS = 5
const LOCK_MS = 15 * 60 * 1000

/** True while the key is locked out after too many wrong passwords. */
export function isLimited(key: string): boolean {
  const f = fails.get(key)
  return !!(f && f.n >= MAX_ATTEMPTS && f.until > Date.now())
}

export function addFail(key: string): void {
  let f = fails.get(key) ?? { n: 0, until: 0 }
  if (f.until && f.until <= Date.now()) f = { n: 0, until: 0 }
  f.n++
  if (f.n >= MAX_ATTEMPTS) f.until = Date.now() + LOCK_MS
  fails.set(key, f)
}

export function clearFails(key: string): void {
  fails.delete(key)
}

/** Drop stale entries so the in-memory map cannot grow forever. */
export function pruneFails(): void {
  const now = Date.now()
  for (const [k, f] of fails) {
    if (f.until && f.until <= now) fails.delete(k)
  }
}
