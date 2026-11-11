const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");
const escapedWorkspaceRoot = workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ownModules = path.join(__dirname, "node_modules");

config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];

// T3 Car reuses the connection and state layer of apps/mobile. Packages this app installs
// itself must resolve to this app's copy from there too, so React, React Native, Effect and
// the Expo modules exist once in the bundle.
const ownsPackage = new Map();
function packageNameOf(moduleName) {
  const parts = moduleName.split("/");
  return moduleName.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}
function isOwnPackage(name) {
  let owned = ownsPackage.get(name);
  if (owned === undefined) {
    owned = fs.existsSync(path.join(ownModules, name));
    ownsPackage.set(name, owned);
  }
  return owned;
}

config.resolver = {
  ...config.resolver,
  blockList: [
    ...(Array.isArray(config.resolver?.blockList)
      ? config.resolver.blockList
      : config.resolver?.blockList
        ? [config.resolver.blockList]
        : []),
    new RegExp(`${escapedWorkspaceRoot}[/\\\\]\\.t3[/\\\\].*`),
  ],
  resolveRequest(context, moduleName, platform) {
    if (
      !moduleName.startsWith(".") &&
      !path.isAbsolute(moduleName) &&
      !context.originModulePath.startsWith(__dirname + path.sep) &&
      isOwnPackage(packageNameOf(moduleName))
    ) {
      return context.resolveRequest(
        { ...context, originModulePath: path.join(__dirname, "index.ts") },
        moduleName,
        platform,
      );
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
