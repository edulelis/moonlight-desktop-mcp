import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applicationDataDirectory, legacyProjectDataDirectory } from "./paths.js";

export class ProfileStore {
  constructor(dataDirectory) {
    this.explicitDataDirectory = Boolean(dataDirectory || process.env.MOONLIGHT_MCP_DATA_DIR);
    this.dataDirectory = dataDirectory || applicationDataDirectory();
    this.profileFile = path.join(this.dataDirectory, "profiles.json");
    this.legacyProfileFile = this.explicitDataDirectory
      ? null
      : path.join(legacyProjectDataDirectory(), "profiles.json");
  }

  async readProfileFile(profileFile) {
    const raw = await readFile(profileFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.profiles) ? parsed.profiles : [];
  }

  async readAll() {
    try {
      return await this.readProfileFile(this.profileFile);
    } catch (error) {
      if (error.code === "ENOENT" && this.legacyProfileFile && this.legacyProfileFile !== this.profileFile) {
        try {
          // Source-checkout versions stored profiles beside the project. Read
          // that file during the one-time path migration so existing paired
          // machines remain usable; a subsequent pairing save writes the new
          // OS-owned location with restrictive permissions.
          return await this.readProfileFile(this.legacyProfileFile);
        } catch (legacyError) {
          if (legacyError.code === "ENOENT") return [];
          throw new Error(`Could not read legacy Moonlight MCP profiles: ${legacyError.message}`);
        }
      }
      if (error.code === "ENOENT") return [];
      throw new Error(`Could not read local Moonlight MCP profiles: ${error.message}`);
    }
  }

  async save(profile) {
    await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
    const profiles = (await this.readAll()).filter((candidate) => candidate.id !== profile.id);
    profiles.push(profile);
    await writeFile(this.profileFile, `${JSON.stringify({ profiles }, null, 2)}\n`, { mode: 0o600 });
  }

  async find(id) {
    const profile = (await this.readAll()).find((candidate) => candidate.id === id);
    if (!profile) throw new Error(`No local Moonlight MCP profile named '${id}'.`);
    return profile;
  }
}
