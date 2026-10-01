#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import coreLock from "../moonlight-core.lock.json" with { type: "json" };
import { defaultMoonlightCoreDirectory, packageRoot } from "../src/paths.js";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? packageRoot, stdio: "inherit" });
  if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
}

const coreDirectory = defaultMoonlightCoreDirectory();
if (!existsSync(coreDirectory)) {
  await mkdir(path.dirname(coreDirectory), { recursive: true, mode: 0o700 });
  run("git", ["clone", "--recursive", coreLock.repository, coreDirectory]);
} else if (!existsSync(path.join(coreDirectory, ".git"))) {
  throw new Error(`${coreDirectory} exists but is not a Git checkout. Set MOONLIGHT_CORE_DIR to a dedicated initialized moonlight-common-c checkout instead.`);
}

run("git", ["fetch", "--tags", "origin"], { cwd: coreDirectory });
run("git", ["checkout", "--detach", coreLock.ref], { cwd: coreDirectory });
run("git", ["submodule", "sync", "--recursive"], { cwd: coreDirectory });
run("git", ["submodule", "update", "--init", "--recursive"], { cwd: coreDirectory });
console.log(`Moonlight core is ready at ${coreDirectory} (${coreLock.ref.slice(0, 12)}).`);
