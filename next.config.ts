import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosting ships a standalone server bundle so the runtime image does not
  // need node_modules. Ignored by Vercel, which builds its own output.
  output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined,
  serverExternalPackages: ["postgres"],
  experimental: {
    // Statement uploads can be several MB of base64 PDF.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
