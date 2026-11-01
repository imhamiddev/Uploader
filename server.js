// Startup file for cPanel "Setup Node.js App" (Passenger) and plain `npm start`.
// Runs the production Next.js server; `instrumentation.ts` starts the cleanup loop.
import { createServer } from "node:http"

import next from "next"

const port = parseInt(process.env.PORT || "3000", 10)
const hostname = process.env.HOST || "0.0.0.0"

const app = next({ dev: false, hostname, port })
const handle = app.getRequestHandler()

await app.prepare()

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("request failed", err)
    if (!res.headersSent) res.statusCode = 500
    res.end("Internal Server Error")
  })
})

// Large downloads and slow 5 MB upload chunks must not be cut off.
server.requestTimeout = 15 * 60 * 1000
server.keepAliveTimeout = 65 * 1000

server.listen(port, hostname, () => {
  console.log(`Uploader ready on http://${hostname}:${port}`)
})

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => server.close(() => process.exit(0)))
}
