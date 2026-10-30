import type { NextConfig } from "next"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  // Local /api/chat spawns axi — keep Node route handlers dynamic.
  serverExternalPackages: ["node-pty"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.aquin.app",
        pathname: "/**",
      },
    ],
  },
  turbopack: {
    root,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

export default nextConfig
