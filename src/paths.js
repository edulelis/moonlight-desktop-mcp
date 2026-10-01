import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function homeDirectory(home) {
  if (!home) throw new Error("Unable to determine the local user home directory.");
  return home;
}

export function applicationDataDirectory({ platform = process.platform, environment = process.env, home = os.homedir() } = {}) {
  if (environment.MOONLIGHT_MCP_DATA_DIR) return path.resolve(environment.MOONLIGHT_MCP_DATA_DIR);
  const userHome = homeDirectory(home);
  if (platform === "win32") return path.join(environment.LOCALAPPDATA || path.join(userHome, "AppData", "Local"), "Moonlight Desktop MCP");
  if (platform === "darwin") return path.join(userHome, "Library", "Application Support", "Moonlight Desktop MCP");
  return path.join(environment.XDG_STATE_HOME || path.join(userHome, ".local", "state"), "moonlight-desktop-mcp");
}

export function applicationCacheDirectory({ platform = process.platform, environment = process.env, home = os.homedir() } = {}) {
  if (environment.MOONLIGHT_MCP_CACHE_DIR) return path.resolve(environment.MOONLIGHT_MCP_CACHE_DIR);
  const userHome = homeDirectory(home);
  if (platform === "win32") return path.join(environment.LOCALAPPDATA || path.join(userHome, "AppData", "Local"), "Moonlight Desktop MCP", "cache");
  if (platform === "darwin") return path.join(userHome, "Library", "Caches", "Moonlight Desktop MCP");
  return path.join(environment.XDG_CACHE_HOME || path.join(userHome, ".cache"), "moonlight-desktop-mcp");
}

export function defaultMoonlightCoreDirectory(options = {}) {
  if (options.environment?.MOONLIGHT_CORE_DIR) return path.resolve(options.environment.MOONLIGHT_CORE_DIR);
  if (!options.environment && process.env.MOONLIGHT_CORE_DIR) return path.resolve(process.env.MOONLIGHT_CORE_DIR);
  return path.join(applicationCacheDirectory(options), "moonlight-common-c");
}

export function nativeBridgeFilename(platform = process.platform) {
  return platform === "win32" ? "moonlight-session-bridge.exe" : "moonlight-session-bridge";
}

export function defaultBridgePath({ platform = process.platform, rootDirectory = packageRoot } = {}) {
  return path.join(rootDirectory, "native", "build", nativeBridgeFilename(platform));
}

export function legacyProjectDataDirectory({ rootDirectory = packageRoot } = {}) {
  return path.join(rootDirectory, "data");
}
