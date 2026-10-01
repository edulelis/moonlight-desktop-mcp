import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function homeDirectory(home) {
  if (!home) throw new Error("Unable to determine the local user home directory.");
  return home;
}

function pathsFor(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

export function applicationDataDirectory({ platform = process.platform, environment = process.env, home = os.homedir() } = {}) {
  const paths = pathsFor(platform);
  if (environment.MOONLIGHT_MCP_DATA_DIR) return paths.resolve(environment.MOONLIGHT_MCP_DATA_DIR);
  const userHome = homeDirectory(home);
  if (platform === "win32") return paths.join(environment.LOCALAPPDATA || paths.join(userHome, "AppData", "Local"), "Moonlight Desktop MCP");
  if (platform === "darwin") return paths.join(userHome, "Library", "Application Support", "Moonlight Desktop MCP");
  return paths.join(environment.XDG_STATE_HOME || paths.join(userHome, ".local", "state"), "moonlight-desktop-mcp");
}

export function applicationCacheDirectory({ platform = process.platform, environment = process.env, home = os.homedir() } = {}) {
  const paths = pathsFor(platform);
  if (environment.MOONLIGHT_MCP_CACHE_DIR) return paths.resolve(environment.MOONLIGHT_MCP_CACHE_DIR);
  const userHome = homeDirectory(home);
  if (platform === "win32") return paths.join(environment.LOCALAPPDATA || paths.join(userHome, "AppData", "Local"), "Moonlight Desktop MCP", "cache");
  if (platform === "darwin") return paths.join(userHome, "Library", "Caches", "Moonlight Desktop MCP");
  return paths.join(environment.XDG_CACHE_HOME || paths.join(userHome, ".cache"), "moonlight-desktop-mcp");
}

export function defaultMoonlightCoreDirectory(options = {}) {
  const platform = options.platform || process.platform;
  const paths = pathsFor(platform);
  if (options.environment?.MOONLIGHT_CORE_DIR) return paths.resolve(options.environment.MOONLIGHT_CORE_DIR);
  if (!options.environment && process.env.MOONLIGHT_CORE_DIR) return paths.resolve(process.env.MOONLIGHT_CORE_DIR);
  return paths.join(applicationCacheDirectory(options), "moonlight-common-c");
}

export function nativeBridgeFilename(platform = process.platform) {
  return platform === "win32" ? "moonlight-session-bridge.exe" : "moonlight-session-bridge";
}

export function defaultBridgePath({ platform = process.platform, rootDirectory = packageRoot } = {}) {
  return pathsFor(platform).join(rootDirectory, "native", "build", nativeBridgeFilename(platform));
}

export function legacyProjectDataDirectory({ rootDirectory = packageRoot } = {}) {
  return path.join(rootDirectory, "data");
}
