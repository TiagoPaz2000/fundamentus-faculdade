import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Pacotes com binários / require dinâmico: não empacotar no bundle do servidor.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "exceljs"],
  // Garante que o Chromium comprimido (bin/*.br) vá junto nas funções que tiram print.
  outputFileTracingIncludes: {
    "/": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/papel/[ticker]": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
