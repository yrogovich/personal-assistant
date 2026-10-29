import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components stays off in v1: every page reads fresh local data,
  // and the app is single-user and local, so there is nothing to prerender.
  serverExternalPackages: ["@libsql/client", "libsql"],
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
