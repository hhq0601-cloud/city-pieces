import type { NextConfig } from "next";

const isEdgeOneStaticExport = process.env.EDGEONE_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  // EdgeOne uses a separate static export. The default remains unchanged for
  // Vercel and for the existing Vinext/Cloudflare build.
  output: isEdgeOneStaticExport ? "export" : undefined,
};

export default nextConfig;
