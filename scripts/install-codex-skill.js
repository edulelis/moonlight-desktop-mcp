#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { packageRoot } from "../src/paths.js";

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
const source = path.join(packageRoot, "agents", "codex", "moonlight-desktop-operator");
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const destination = path.join(codexHome, "skills", "moonlight-desktop-operator");

await stat(path.join(source, "SKILL.md"));
if (existsSync(destination) && !force && !dryRun) {
  throw new Error(`${destination} already exists. Review it first, or rerun with --force to replace only this skill.`);
}
if (dryRun) {
  console.log(JSON.stringify({ source, destination, action: existsSync(destination) ? "replace" : "install" }, null, 2));
} else {
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  if (existsSync(destination)) await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true, force: true });
  console.log(`Installed Codex skill at ${destination}.`);
}
