// The phone app installs on its own (it is not part of the pnpm workspace), but it shares
// code with the web app from ../../packages/core. Metro needs three things for that:
//   1. watch the shared folder, which sits outside this project;
//   2. look for third-party modules (zod) in this app's node_modules, because the shared
//      folder has none of its own when only the phone app is installed;
//   3. map "./gps.js" to "./gps.ts": the shared code writes ".js" in relative imports
//      while shipping ".ts" source.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const sharedCore = path.resolve(__dirname, "../../packages/core");
const config = getDefaultConfig(__dirname);

config.watchFolders = [sharedCore];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js") && context.originModulePath.startsWith(sharedCore)) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    } catch {
      // fall through to the normal lookup
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
