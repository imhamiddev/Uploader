// Startup file for cPanel "Setup Node.js App" (LiteSpeed lsnode / Passenger) and `npm start`.
// CommonJS without top-level await on purpose: lsnode loads this file with require().
const http = require("node:http")
const next = require("next")

const port = parseInt(process.env.PORT || "3000", 10)
const hostname = process.env.HOST || "0.0.0.0"

const app = next({ dev: false, hostname, port })
const handle = app.getRequestHandler()

app
  .prepare()
  .then(() => {
    const server = http.createServer((req, res) => {
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
  })
  .catch((err) => {
    console.error("failed to start", err)
    process.exit(1)
  })
