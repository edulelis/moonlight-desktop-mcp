#!/usr/bin/env node
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { applicationDataDirectory, legacyProjectDataDirectory } from "../src/paths.js";

const dryRun = process.argv.includes("--dry-run");
const source = path.join(legacyProjectDataDirectory(), "profiles.json");
const destination = path.join(applicationDataDirectory(), "profiles.json");

if (!existsSync(source)) {
  console.log("No legacy paired-profile file exists; nothing to migrate.");
} else if (existsSync(destination)) {
  console.log(`A state profile already exists at ${destination}; leaving both files unchanged.`);
} else if (dryRun) {
  console.log(JSON.stringify({ source, destination, action: "copy paired profile" }, null, 2));
} else {
  const profileData = await readFile(source, "utf8");
  // Parse before writing so malformed legacy data never becomes the active
  // state file. The profile contents remain local and are never printed.
  JSON.parse(profileData);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(destination), 0o700);
  await writeFile(destination, profileData, { mode: 0o600, flag: "wx" });
  console.log(`Migrated the paired profile to ${destination}.`);
}
