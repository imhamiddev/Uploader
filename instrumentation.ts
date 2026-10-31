/**
 * Runs once when the Next.js server starts. Boots the JSON database
 * recovery and the periodic expiry cleanup.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
    console.error("ADMIN_USER and ADMIN_PASS environment variables are required.")
    return
  }
  const { startCleanupLoop } = await import("./lib/server/cleanup")
  startCleanupLoop()
}
