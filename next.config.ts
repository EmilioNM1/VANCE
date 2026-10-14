import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Librerías de procesamiento documental que solo deben ejecutarse en Node.
  serverExternalPackages: ["unpdf", "mammoth", "jszip", "pg", "pdfkit"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
