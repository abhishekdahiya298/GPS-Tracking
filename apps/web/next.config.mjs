/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@rio-gps/core", "@rio-gps/db", "@rio-gps/traccar-client"],
  // Friendly aliases (owner decision: keep existing URLs, which emails link to).
  async redirects() {
    return [
      { source: "/zones", destination: "/geofences", permanent: false },
      { source: "/account", destination: "/settings/account", permanent: false },
      { source: "/my-account", destination: "/settings/account", permanent: false }
    ];
  },
  // Versioned API paths for the mobile app: /api/v1/... is today's API. When the API changes
  // in a way that would break an installed app, the old shape stays reachable under /api/v1.
  // Sign-in stays at /api/auth (the auth library serves it at that fixed path).
  async rewrites() {
    return [{ source: "/api/v1/:path((?!auth/).*)", destination: "/api/:path" }];
  },
  webpack: (config) => {
    // Our workspace packages use TS-ESM-style ".js" extensions in relative
    // imports (correct for real Node ESM resolution) while shipping only
    // ".ts" source (no build step). Webpack can't map .js -> .ts on its own.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"]
    };
    return config;
  }
};

export default nextConfig;
