/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // archiver-zip-encrypted pulls in native-ish deps; keep them out of the bundle.
  serverExternalPackages: ["archiver", "archiver-zip-encrypted"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ]
  },
}

export default nextConfig
