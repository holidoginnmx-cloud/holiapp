const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Make Metro aware of packages hoisted to workspace root
config.watchFolders = [workspaceRoot];

// Resolve order: workspace-local node_modules first, then root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Force expo-crypto to always resolve to the SDK-54 copy (15.0.8)
// Prevents Metro from picking up expo-auth-session's nested expo-crypto@55.x
// Mock react-dom for native — @clerk/clerk-react imports it for web portals which aren't needed on native
config.resolver.extraNodeModules = {
  "expo-crypto": path.resolve(projectRoot, "node_modules/expo-crypto"),
  "react-dom": path.resolve(projectRoot, "src/mocks/react-dom.js"),
};

module.exports = config;
