/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@rio-gps/core", "@rio-gps/db", "@rio-gps/traccar-client"],
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
