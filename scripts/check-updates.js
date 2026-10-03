#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import packageInfo from "../package.json" with { type: "json" };
import coreLock from "../moonlight-core.lock.json" with { type: "json" };
import { packageRoot } from "../src/paths.js";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: packageRoot, encoding: "utf8" });
  return {
    available: !result.error,
    status: result.status,
    stdout: result.stdout?.trim() || "",
    stderr: result.stderr?.trim() || "",
  };
}

function gitValue(args) {
  const result = run("git", args);
  return result.status === 0 ? result.stdout : null;
}

function dependencyUpdates() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = run(npm, ["outdated", "--json", "--depth=0"]);
  if (!result.available) return { checked: false, reason: "npm is unavailable." };
  if (result.status !== 0 && result.status !== 1) return { checked: false, reason: result.stderr || "npm could not query dependency updates." };
  try {
    return { checked: true, updates: result.stdout ? JSON.parse(result.stdout) : {} };
  } catch {
    return { checked: false, reason: "npm returned an unreadable update response." };
  }
}

const remoteRequested = process.argv.includes("--remote");
const sourceCheckout = gitValue(["rev-parse", "--is-inside-work-tree"]) === "true";
const source = { checkout: sourceCheckout };
if (sourceCheckout) {
  source.currentCommit = gitValue(["rev-parse", "HEAD"]);
  source.branch = gitValue(["branch", "--show-current"]);
  source.dirty = Boolean(gitValue(["status", "--porcelain"]));
  source.origin = gitValue(["remote", "get-url", "origin"]);
  if (remoteRequested && source.origin) {
    const remote = run("git", ["ls-remote", "origin", "HEAD"]);
    if (remote.status === 0) source.remoteHead = remote.stdout.split(/\s+/)[0] || null;
    else source.remoteCheckError = remote.stderr || "Could not query origin.";
  }
}

const report = {
  name: packageInfo.name,
  installedVersion: packageInfo.version,
  checkedAt: new Date().toISOString(),
  source,
  pinnedMoonlightCore: { repository: coreLock.repository, ref: coreLock.ref },
  dependencyUpdates: dependencyUpdates(),
  recommendations: [
    "Review update output before changing files; this command never installs or updates anything.",
    "For a normal managed installation, rerun the one-command installer in docs/INSTALL.md.",
    "For an intentional source checkout, follow docs/DEVELOPMENT.md#update-a-source-checkout.",
    "Do not delete the MCP data directory during an update; it stores the paired client identity.",
  ],
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`${report.name} ${report.installedVersion}`);
  if (!sourceCheckout) console.log("Source: not a Git checkout; use the release/source location that installed this copy to obtain a newer MCP version.");
  else {
    console.log(`Source: ${source.currentCommit}${source.dirty ? " (local changes present)" : ""}`);
    if (remoteRequested) console.log(source.remoteHead ? `Origin HEAD: ${source.remoteHead}` : `Origin: ${source.remoteCheckError ?? "not configured"}`);
    else console.log("Source remote: not queried (rerun with --remote for a read-only comparison).");
  }
  const updates = report.dependencyUpdates.checked ? Object.keys(report.dependencyUpdates.updates) : [];
  console.log(updates.length ? `Dependency updates: ${updates.join(", ")}` : "Dependency updates: none reported.");
  console.log("Normal installation update: rerun the one-command installer in docs/INSTALL.md.");
  console.log("Source checkout update: follow docs/DEVELOPMENT.md#update-a-source-checkout.");
}

// Keep the otherwise unused import check meaningful for packaged source
// layouts: a package installation must include its manifest beside this script.
if (!existsSync(path.join(packageRoot, "package.json"))) process.exitCode = 1;
