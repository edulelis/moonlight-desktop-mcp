#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { defaultMoonlightCoreDirectory, packageRoot } from "../src/paths.js";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: packageRoot, stdio: "inherit" });
  if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
}

const coreDirectory = defaultMoonlightCoreDirectory();
if (!existsSync(path.join(coreDirectory, "CMakeLists.txt"))) {
  throw new Error(`Moonlight core was not found at ${coreDirectory}. Run \"npm run setup:native\" or set MOONLIGHT_CORE_DIR to an initialized moonlight-common-c checkout.`);
}

const buildDirectory = path.join(packageRoot, "native", "build");
const buildType = process.env.MOONLIGHT_MCP_BUILD_TYPE || "Release";
const configureArgs = [
  "-S", path.join(packageRoot, "native"),
  "-B", buildDirectory,
  `-DMOONLIGHT_CORE_DIR=${coreDirectory}`,
  `-DCMAKE_BUILD_TYPE=${buildType}`,
];
if (process.env.CMAKE_TOOLCHAIN_FILE) configureArgs.push(`-DCMAKE_TOOLCHAIN_FILE=${process.env.CMAKE_TOOLCHAIN_FILE}`);
if (process.env.CMAKE_GENERATOR) configureArgs.push("-G", process.env.CMAKE_GENERATOR);
if (process.env.CMAKE_PREFIX_PATH) configureArgs.push(`-DCMAKE_PREFIX_PATH=${process.env.CMAKE_PREFIX_PATH}`);
run("cmake", configureArgs);
run("cmake", ["--build", buildDirectory, "--config", buildType, "--parallel"]);
