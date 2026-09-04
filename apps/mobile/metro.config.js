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

// Mock react-dom for native — @clerk/clerk-react imports it for web portals which aren't needed on native.
//
// Aquí vivía también un alias de expo-crypto: expo-auth-session traía anidada
// una copia 55.x y había que forzar la del SDK 54. Al alinear las versiones
// (expo-auth-session 7.0.11 ya pide ~15.0.9, la misma del SDK) quedó una sola
// copia hoistada a la raíz del monorepo y el alias apuntaba a una ruta que ya
// no existe. Si vuelve a aparecer una copia duplicada, la causa es un paquete
// desalineado con el SDK: arréglalo ahí, no con otro alias.
config.resolver.extraNodeModules = {
  "react-dom": path.resolve(projectRoot, "src/mocks/react-dom.js"),
};

module.exports = config;
