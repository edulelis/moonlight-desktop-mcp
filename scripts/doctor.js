#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { applicationDataDirectory, defaultBridgePath, defaultMoonlightCoreDirectory } from "../src/paths.js";

function commandVersion(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || result.stderr).trim().split("\n")[0] || "available";
}

const major = Number(process.versions.node.split(".")[0]);
const platformSupported = ["darwin", "linux", "win32"].includes(process.platform);
const coreDirectory = defaultMoonlightCoreDirectory();
const bridgePath = defaultBridgePath();
const report = {
  name: "moonlight-desktop-mcp",
  version: "0.5.0",
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  nodeSupported: major >= 20,
  platformSupported,
  dataDirectory: applicationDataDirectory(),
  moonlightCoreDirectory: coreDirectory,
  moonlightCoreReady: existsSync(`${coreDirectory}/CMakeLists.txt`),
  nativeBridgePath: bridgePath,
  nativeBridgeReady: existsSync(bridgePath),
  dependencies: {
    git: commandVersion("git", ["--version"]),
    cmake: commandVersion("cmake", ["--version"]),
  },
};
report.readyForDesktop = report.nodeSupported && report.platformSupported && report.nativeBridgeReady;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`${report.name} ${report.version}`);
  console.log(`Platform: ${report.platform}/${report.architecture} | Node: ${report.node} (${report.nodeSupported ? "supported" : "Node 20+ required"})`);
  console.log(`Data: ${report.dataDirectory}`);
  console.log(`Moonlight core: ${report.moonlightCoreReady ? "ready" : "missing"} (${report.moonlightCoreDirectory})`);
  console.log(`Native bridge: ${report.nativeBridgeReady ? "ready" : "missing"} (${report.nativeBridgePath})`);
  console.log(`Tools: git ${report.dependencies.git ?? "missing"}; cmake ${report.dependencies.cmake ?? "missing"}`);
  if (!report.moonlightCoreReady) console.log("Next: npm run setup:native");
  else if (!report.nativeBridgeReady) console.log("Next: npm run build:native");
}

if (process.argv.includes("--strict") && !report.readyForDesktop) process.exitCode = 1;
