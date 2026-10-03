import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { getServerInfo } from "./host.js";
import { cancelApp, launchApp, listApps } from "./pairing.js";
import { applicationDataDirectory, defaultBridgePath } from "./paths.js";
import { cropRgb, diffRgb } from "./vision.js";

export const DESKTOP_APP_ID = 881448767;

export const DESKTOP_STREAM_PROFILES = Object.freeze({
  full_hd: Object.freeze({ width: 1920, height: 1080, fps: 30, bitrate: 20_000 }),
  low_bandwidth: Object.freeze({ width: 1280, height: 720, fps: 30, bitrate: 8_000 }),
});

export const DEFAULT_DESKTOP_STREAM_PROFILE = "full_hd";

export function desktopStreamSettings({ streamProfile = DEFAULT_DESKTOP_STREAM_PROFILE, width, height, fps, bitrate } = {}) {
  const profile = DESKTOP_STREAM_PROFILES[streamProfile];
  if (!profile) throw new Error(`Unknown Desktop stream profile '${streamProfile}'.`);
  return {
    width: width ?? profile.width,
    height: height ?? profile.height,
    fps: fps ?? profile.fps,
    bitrate: bitrate ?? profile.bitrate,
  };
}

export const HEADLESS_DESKTOP_CHANNEL = Object.freeze({
  id: "moonlight-desktop",
  kind: "headless_moonlight_desktop",
  transport: "moonlight_gamestream",
  inputTarget: "remote_desktop",
  localGuiFallback: "refuse",
});

export const HEADLESS_PROVIDER_APP_CHANNEL = Object.freeze({
  id: "moonlight-provider-app",
  kind: "headless_moonlight_provider_app",
  transport: "moonlight_gamestream",
  inputTarget: "remote_provider_app",
  localGuiFallback: "refuse",
});

const sessionRoot = path.join(applicationDataDirectory(), "sessions");

export function sessionTarget(profile) {
  return {
    profileId: profile.id,
    deviceName: profile.deviceName,
    host: {
      address: profile.host.address,
      port: profile.host.port,
    },
  };
}

export function isDesktopSession(session) {
  return session.appId === DESKTOP_APP_ID;
}

export function transportSessionView(session) {
  const view = sessionView(session);
  return {
    sessionId: view.sessionId,
    state: view.state,
    channel: view.channel,
  };
}

export function desktopChannelNextAction({
  nativeBridgeReady,
  pairedTargetCount,
  desktopSessions,
  transportSessions = [],
  launchPreparationInProgress = false,
}) {
  if (!nativeBridgeReady) {
    return "The dedicated headless remote Desktop channel is unavailable because its native Moonlight bridge is not ready. Repair this MCP's local bridge before starting a session; do not fall back to generic GUI computer use.";
  }
  const occupiedSessions = transportSessions.length > 0 ? transportSessions : desktopSessions;
  const stoppingSession = occupiedSessions.find((session) => session.state === "stopping");
  if (stoppingSession) {
    return `Moonlight transport session ${stoppingSession.sessionId} is stopping. Wait for it to end, then call desktop_channel_status again before preflighting or starting a Desktop session.`;
  }
  const nonDesktopSession = occupiedSessions.find((session) => session.channel.id !== HEADLESS_DESKTOP_CHANNEL.id);
  if (nonDesktopSession) {
    return `The Moonlight transport is occupied by this MCP's ${nonDesktopSession.channel.kind} session ${nonDesktopSession.sessionId} (${nonDesktopSession.state}). Call session_status with that sessionId; do not start another Desktop session. Stop it only if it is the owned session the user asked to end.`;
  }
  const activeSession = desktopSessions.find((session) => session.state === "active");
  if (activeSession) return "Call screen_capture with the active Desktop sessionId.";
  if (launchPreparationInProgress) {
    return "A Moonlight transport launch is already being prepared by this MCP. Wait for that session_start call to return or fail, then call desktop_channel_status again before starting another Desktop session.";
  }
  if (occupiedSessions.length > 0) {
    const session = occupiedSessions[0];
    return `The Moonlight transport is occupied by this MCP's ${session.channel.kind} session ${session.sessionId} (${session.state}). Call session_status with that sessionId; do not start another Desktop session. Stop it only if it is the owned session the user asked to end.`;
  }
  if (pairedTargetCount > 0) return "Call session_preflight with a paired profileId.";
  return "Call pairing_begin to create a dedicated paired target.";
}

export function sessionView(session) {
  return {
    channel: isDesktopSession(session) ? HEADLESS_DESKTOP_CHANNEL : HEADLESS_PROVIDER_APP_CHANNEL,
    target: sessionTarget(session.profile),
    sessionId: session.id,
    profileId: session.profileId,
    appId: session.appId,
    appName: session.appName,
    state: session.state,
    width: session.width,
    height: session.height,
    fps: session.fps,
    bitrateKbps: session.bitrate,
    frameSequence: session.frameSequence,
    frameCapturedAt: session.frameCapturedAt,
    lastEvent: session.lastEvent,
    visualBaselineStable: session.visualBaselineStable,
  };
}

function noLineBreaks(value, name) {
  if (String(value).includes("\n") || String(value).includes("\r")) {
    throw new Error(`${name} cannot contain line breaks.`);
  }
  return String(value);
}

function isTransientCaptureStartError(error) {
  return error instanceof Error && /failed to initialize video capture\/encoding/i.test(error.message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value++) {
    let current = value;
    for (let bit = 0; bit < 8; bit++) current = (current >>> 1) ^ (current & 1 ? 0xedb88320 : 0);
    table[value] = current >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(buffer) {
  let current = 0xffffffff;
  for (const byte of buffer) current = CRC_TABLE[(current ^ byte) & 0xff] ^ (current >>> 8);
  return (current ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.allocUnsafe(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function nextPpmToken(buffer, start) {
  let offset = start;
  while (offset < buffer.length) {
    if (buffer[offset] === 0x23) { // # comment
      while (offset < buffer.length && buffer[offset] !== 0x0a) offset++;
    } else if (/\s/.test(String.fromCharCode(buffer[offset]))) {
      offset++;
    } else break;
  }
  const tokenStart = offset;
  while (offset < buffer.length && !/\s/.test(String.fromCharCode(buffer[offset]))) offset++;
  if (tokenStart === offset) throw new Error("Invalid PPM frame header.");
  return { value: buffer.toString("ascii", tokenStart, offset), end: offset };
}

export function ppmToRgb(ppm) {
  const magic = nextPpmToken(ppm, 0);
  const widthToken = nextPpmToken(ppm, magic.end);
  const heightToken = nextPpmToken(ppm, widthToken.end);
  const maximumToken = nextPpmToken(ppm, heightToken.end);
  const width = Number(widthToken.value);
  const height = Number(heightToken.value);
  if (magic.value !== "P6" || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || maximumToken.value !== "255") {
    throw new Error("Invalid RGB PPM frame.");
  }
  let dataOffset = maximumToken.end;
  if (ppm[dataOffset] === 0x0d && ppm[dataOffset + 1] === 0x0a) dataOffset += 2;
  else if (/\s/.test(String.fromCharCode(ppm[dataOffset] ?? 0))) dataOffset++;
  else throw new Error("PPM frame is missing pixel data.");
  const sourceLength = width * height * 3;
  if (!Number.isSafeInteger(sourceLength) || ppm.length < dataOffset + sourceLength) throw new Error("PPM frame is truncated.");

  return { width, height, pixels: Buffer.from(ppm.subarray(dataOffset, dataOffset + sourceLength)) };
}

export function rgbToPng({ width, height, pixels }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !Buffer.isBuffer(pixels) || pixels.length !== width * height * 3) {
    throw new Error("Invalid RGB frame.");
  }
  const scanlines = Buffer.allocUnsafe((width * 3 + 1) * height);
  for (let row = 0; row < height; row++) {
    const targetOffset = row * (width * 3 + 1);
    scanlines[targetOffset] = 0;
    pixels.copy(scanlines, targetOffset + 1, row * width * 3, (row + 1) * width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2; // RGB
  return {
    width,
    height,
    png: Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(scanlines)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  };
}

export function ppmToPng(ppm) {
  return rgbToPng(ppmToRgb(ppm));
}

export class SessionManager extends EventEmitter {
  constructor({ bridgePath = defaultBridgePath(), rootDirectory = sessionRoot } = {}) {
    super();
    this.bridgePath = bridgePath;
    this.rootDirectory = rootDirectory;
    this.sessions = new Map();
    this.startReservation = null;
  }

  find(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No active session named '${sessionId}'.`);
    return session;
  }

  status(sessionId) {
    return sessionView(this.find(sessionId));
  }

  list() {
    return [...this.sessions.values()].map((session) => sessionView(session));
  }

  hasStartReservation() {
    return this.startReservation !== null;
  }

  async start(profile, { appId = DESKTOP_APP_ID, appName = "Desktop", width = DESKTOP_STREAM_PROFILES[DEFAULT_DESKTOP_STREAM_PROFILE].width, height = DESKTOP_STREAM_PROFILES[DEFAULT_DESKTOP_STREAM_PROFILE].height, fps = DESKTOP_STREAM_PROFILES[DEFAULT_DESKTOP_STREAM_PROFILE].fps, bitrate = DESKTOP_STREAM_PROFILES[DEFAULT_DESKTOP_STREAM_PROFILE].bitrate } = {}) {
    const occupiedSession = [...this.sessions.values()].find((session) =>
      ["launching", "starting", "active", "stopping"].includes(session.state));
    if (occupiedSession) {
      throw new Error(`Moonlight transport session '${occupiedSession.id}' is ${occupiedSession.state}. Wait for it to end before starting another session.`);
    }
    if (this.startReservation) {
      throw new Error("A Moonlight transport launch is already being prepared. Wait for it to return or fail before starting another session.");
    }
    this.startReservation = { startedAt: Date.now() };

    try {
      await fs.access(this.bridgePath);
      const serverInfo = await getServerInfo(profile.host);
      if (serverInfo.currentGame !== 0) {
        let appName;
        try {
          appName = (await listApps(profile)).find((app) => app.id === serverInfo.currentGame)?.name;
        } catch {
          // The channel warning remains useful even if app discovery is unavailable.
        }
        throw new Error(`Moonlight streaming channel is already in use by ${appName ?? `app ID ${serverInfo.currentGame}`}. This MCP will not take over an existing session; attach/recovery support is not implemented yet.`);
      }

      const id = randomBytes(12).toString("hex");
      const directory = path.join(this.rootDirectory, id);
      const framePath = path.join(directory, "latest.ppm");
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.chmod(directory, 0o700);

      const inputKey = randomBytes(16);
      const inputIv = Buffer.alloc(16);
      randomBytes(4).copy(inputIv);
      const session = {
        id,
        profile,
        profileId: profile.id,
        appId,
        appName,
        width,
        height,
        fps,
        bitrate,
        directory,
        framePath,
        state: "launching",
        frameSequence: 0,
        frameCapturedAt: null,
        visualBaselineStable: null,
        lastEvent: appId === DESKTOP_APP_ID ? "launching_desktop" : "launching_provider_app",
        waiters: [],
        child: null,
        launched: false,
        stopping: false,
        stopPromise: null,
        unexpectedCleanupPromise: null,
        snapshots: new Map(),
        snapshotOrder: [],
        latestSnapshotId: null,
        templates: new Map(),
      };
      this.sessions.set(id, session);

      try {
        let launch;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            launch = await launchApp(profile, { appId, width, height, fps, inputKey, inputIv });
            break;
          } catch (error) {
            if (!isTransientCaptureStartError(error) || attempt === 2) throw error;
            // Apollo can report this briefly after a prior stream ends while its
            // capture pipeline is still being released. The channel remains
            // free, so retrying this one host response is safe and useful.
            session.lastEvent = `retrying_video_capture_${attempt + 1}`;
            await delay(750 * (attempt + 1));
          }
        }
        session.launched = true;
        session.state = "starting";
        session.lastEvent = "starting_native_transport";
        await this.startBridge(session, { serverInfo, rtspSessionUrl: launch.rtspSessionUrl, inputKey, inputIv });
        await this.waitFor(session, (event) => event.type === "connected" || event.type === "stage_failed" || event.type === "connection_error" || event.type === "exit", 25_000);
        if (session.state !== "active") throw new Error(`Moonlight transport did not connect (${session.lastEvent}).`);
        // Apollo can publish several transitional frames while its Desktop
        // capture surface comes up. A frame count alone is not reliable, so
        // attempt to establish two consecutive quiet frames before returning;
        // continuously animated Desktops remain usable and are marked as such.
        await this.waitForVisualBaseline(session);
        return sessionView(session);
      } catch (error) {
        await this.stop(id, { cancelRemote: true, keepRecord: true }).catch(() => {});
        throw error;
      } finally {
        inputKey.fill(0);
        inputIv.fill(0);
      }
    } finally {
      this.startReservation = null;
    }
  }

  async startBridge(session, { serverInfo, rtspSessionUrl, inputKey, inputIv }) {
    const child = spawn(this.bridgePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    session.child = child;
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      let newline;
      while ((newline = stdout.indexOf("\n")) !== -1) {
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        try { this.handleBridgeEvent(session, JSON.parse(line)); } catch { /* native diagnostic outside its NDJSON protocol */ }
      }
    });
    child.stderr.resume();
    child.on("error", (error) => this.handleBridgeEvent(session, { type: "bridge_error", detail: error.message }));
    child.on("exit", (code, signal) => this.handleBridgeEvent(session, { type: "exit", code, signal }));

    const config = {
      host: serverInfo.hostname ? profileAddress(session.profile.host.address) : profileAddress(session.profile.host.address),
      app_version: serverInfo.appVersion,
      gfe_version: serverInfo.gfeVersion,
      rtsp_url: rtspSessionUrl,
      frame_path: session.framePath,
      input_key_hex: inputKey.toString("hex"),
      input_iv_hex: inputIv.toString("hex"),
      codec_mode_support: serverInfo.codecModeSupport,
      width: session.width,
      height: session.height,
      fps: session.fps,
      bitrate: session.bitrate,
    };
    const payload = `${Object.entries(config).map(([key, value]) => `${key}=${noLineBreaks(value, key)}`).join("\n")}\nstart\n`;
    child.stdin.write(payload);
  }

  handleBridgeEvent(session, event) {
    const wasActive = session.state === "active";
    session.lastNativeEvent = event;
    session.lastEvent = event.type;
    if (event.type === "connected") session.state = "active";
    if (event.type === "frame") {
      session.frameSequence = event.sequence;
      session.width = event.width;
      session.height = event.height;
      session.frameCapturedAt = new Date().toISOString();
    }
    if (["stage_failed", "connection_error", "bridge_error", "terminated"].includes(event.type) && session.state !== "stopping") session.state = "failed";
    if (event.type === "exit" && session.state !== "stopping") session.state = "ended";
    for (const waiter of session.waiters.splice(0)) {
      if (waiter.predicate(event)) waiter.resolve(event);
      else session.waiters.push(waiter);
    }
    this.emit("event", sessionView(session));
    if (wasActive && !session.stopping && ["terminated", "connection_error", "bridge_error", "exit"].includes(event.type)) {
      this.cleanupUnexpected(session, event.type);
    }
  }

  cleanupUnexpected(session, reason) {
    if (session.unexpectedCleanupPromise) return session.unexpectedCleanupPromise;
    session.unexpectedCleanupPromise = this.stop(session.id, { cancelRemote: true, keepRecord: true })
      .catch(() => {})
      .then(() => {
        session.lastEvent = `ended_after_${reason}`;
        this.emit("event", sessionView(session));
      });
    return session.unexpectedCleanupPromise;
  }

  waitFor(session, predicate, timeoutMs) {
    if (session.lastNativeEvent && predicate(session.lastNativeEvent)) return Promise.resolve(session.lastNativeEvent);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.waiters = session.waiters.filter((waiter) => waiter !== current);
        reject(new Error("Timed out waiting for Moonlight transport startup."));
      }, timeoutMs);
      const current = {
        predicate,
        resolve: (event) => { clearTimeout(timeout); resolve(event); },
      };
      session.waiters.push(current);
    });
  }

  async waitForVisualBaseline(session) {
    let sequence = session.frameSequence;
    let previous = null;
    let stablePairs = 0;
    let lastComparison = null;
    for (let attempt = 0; attempt < 14; attempt++) {
      const event = await this.waitFor(session, (next) =>
        (next.type === "frame" && next.sequence > sequence) ||
        ["stage_failed", "connection_error", "bridge_error", "terminated", "exit"].includes(next.type), 5_000);
      if (event.type !== "frame") throw new Error(`Moonlight transport ended before its visual baseline was ready (${event.type}).`);
      sequence = event.sequence;
      const capture = await this.capture(session.id, 10_000);
      const current = this.getSnapshot(session.id, capture.snapshotId);
      if (previous && current.frameSequence >= 6) {
        lastComparison = diffRgb(previous, current, { pixelThreshold: 32 });
        if (lastComparison.changedPixelFraction < 0.003) stablePairs++;
        else stablePairs = 0;
        if (stablePairs >= 2) {
          session.lastEvent = "visual_baseline_ready";
          session.visualBaselineStable = true;
          return current;
        }
      }
      previous = current;
    }
    // Games, video, and animated launchers may never have two quiet frames.
    // They are still usable Desktop sessions; expose that fact so callers can
    // scope their visual comparison to a relevant UI region instead of
    // treating a live animated desktop as a failed connection.
    session.lastEvent = "visual_baseline_unstable";
    session.visualBaselineStable = false;
    return previous;
  }

  async capture(sessionId, maxAgeMs = 500) {
    const session = this.find(sessionId);
    if (session.state !== "active") throw new Error(`Session '${sessionId}' is not active (${session.state}).`);
    if (!session.frameCapturedAt || Date.now() - Date.parse(session.frameCapturedAt) > maxAgeMs) {
      const previousSequence = session.frameSequence;
      this.send(sessionId, "frame");
      const event = await this.waitFor(session, (next) => (next.type === "frame" && next.sequence > previousSequence) || ["stage_failed", "connection_error", "exit"].includes(next.type), 4_000);
      if (event.type !== "frame") throw new Error("No fresh video frame is available from the Moonlight session.");
    }
    const rgb = ppmToRgb(await fs.readFile(session.framePath));
    const snapshot = this.rememberSnapshot(session, rgb);
    return { ...sessionView(session), ...rgbToPng(rgb), snapshotId: snapshot.id, pixels: snapshot.pixels };
  }

  rememberSnapshot(session, rgb) {
    const latest = session.latestSnapshotId ? session.snapshots.get(session.latestSnapshotId) : null;
    if (latest && latest.frameSequence === session.frameSequence && latest.width === rgb.width && latest.height === rgb.height) return latest;
    const snapshot = {
      id: `${session.id}-${session.frameSequence}-${randomBytes(4).toString("hex")}`,
      width: rgb.width,
      height: rgb.height,
      pixels: Buffer.from(rgb.pixels),
      frameSequence: session.frameSequence,
      frameCapturedAt: session.frameCapturedAt,
    };
    session.snapshots.set(snapshot.id, snapshot);
    session.snapshotOrder.push(snapshot.id);
    session.latestSnapshotId = snapshot.id;
    while (session.snapshotOrder.length > 12) session.snapshots.delete(session.snapshotOrder.shift());
    return snapshot;
  }

  getSnapshot(sessionId, snapshotId) {
    const session = this.find(sessionId);
    const id = snapshotId ?? session.latestSnapshotId;
    if (!id) throw new Error("Capture a screen snapshot before using a vision helper.");
    const snapshot = session.snapshots.get(id);
    if (!snapshot) throw new Error(`No retained screen snapshot named '${id}' for this session.`);
    return snapshot;
  }

  createTemplate(sessionId, snapshotId, frame) {
    const session = this.find(sessionId);
    this.getSnapshot(sessionId, snapshotId);
    const id = `${session.id}-template-${randomBytes(5).toString("hex")}`;
    session.templates.set(id, { id, width: frame.width, height: frame.height, pixels: Buffer.from(frame.pixels), sourceSnapshotId: snapshotId });
    return { id, width: frame.width, height: frame.height, sourceSnapshotId: snapshotId };
  }

  getTemplate(sessionId, templateId) {
    const session = this.find(sessionId);
    const template = session.templates.get(templateId);
    if (!template) throw new Error(`No retained screen template named '${templateId}' for this session.`);
    return template;
  }

  async waitForVisualChange(sessionId, {
    baselineSnapshotId,
    timeoutMs = 5_000,
    minChangedFraction = 0.003,
    pixelThreshold = 32,
    region,
  } = {}) {
    const session = this.find(sessionId);
    if (session.state !== "active") throw new Error(`Session '${sessionId}' is not active (${session.state}).`);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) throw new Error("timeoutMs must be an integer from 250 through 30000.");
    if (typeof minChangedFraction !== "number" || minChangedFraction <= 0 || minChangedFraction > 1) throw new Error("minChangedFraction must be greater than 0 and at most 1.");
    const baseline = this.getSnapshot(sessionId, baselineSnapshotId);
    const deadline = Date.now() + timeoutMs;
    let sequence = session.frameSequence;
    let current = baseline;
    let comparison = this.diffRegion(baseline, current, { pixelThreshold, region });
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      let event;
      try {
        event = await this.waitFor(session, (next) =>
          (next.type === "frame" && next.sequence > sequence) ||
          ["stage_failed", "connection_error", "bridge_error", "terminated", "exit"].includes(next.type), Math.min(remaining, 1_000));
      } catch {
        this.send(sessionId, "frame");
        continue;
      }
      if (event.type !== "frame") throw new Error(`Moonlight transport ended while waiting for a visual change (${event.type}).`);
      sequence = event.sequence;
      const capture = await this.capture(sessionId, 10_000);
      current = this.getSnapshot(sessionId, capture.snapshotId);
      comparison = this.diffRegion(baseline, current, { pixelThreshold, region });
      if (comparison.changedPixelFraction >= minChangedFraction) {
        return { changed: true, baseline, current, comparison };
      }
    }
    return { changed: false, baseline, current, comparison, timedOut: true };
  }

  diffRegion(baseline, current, { pixelThreshold, region }) {
    if (!region) return diffRgb(baseline, current, { pixelThreshold });
    const baselineCrop = cropRgb(baseline, region);
    const currentCrop = cropRgb(current, region);
    const comparison = diffRgb(baselineCrop, currentCrop, { pixelThreshold });
    if (comparison.boundingBox) {
      comparison.boundingBox = {
        ...comparison.boundingBox,
        x: comparison.boundingBox.x + baselineCrop.x,
        y: comparison.boundingBox.y + baselineCrop.y,
      };
    }
    return comparison;
  }

  send(sessionId, command) {
    const session = this.find(sessionId);
    if (session.state !== "active" || !session.child?.stdin.writable) throw new Error(`Session '${sessionId}' is not accepting input.`);
    session.child.stdin.write(`${command}\n`);
    return sessionView(session);
  }

  async stop(sessionId, { cancelRemote = true, keepRecord = false } = {}) {
    const session = this.find(sessionId);
    if (session.stopPromise) return session.stopPromise;
    session.stopPromise = this.stopSession(session, { cancelRemote, keepRecord });
    return session.stopPromise;
  }

  async stopAll({ cancelRemote = true } = {}) {
    const running = [...this.sessions.values()].filter((session) => session.state !== "ended");
    await Promise.allSettled(running.map((session) => this.stop(session.id, { cancelRemote, keepRecord: true })));
    return running.map((session) => sessionView(session));
  }

  async stopSession(session, { cancelRemote, keepRecord }) {
    session.stopping = true;
    session.state = "stopping";
    session.lastEvent = "stopping";
    let childExit;
    if (session.child && session.child.exitCode === null) {
      childExit = new Promise((resolve) => session.child.once("exit", resolve));
    }
    if (session.child?.stdin.writable) session.child.stdin.write("stop\n");
    if (childExit) await Promise.race([childExit, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (session.launched && cancelRemote) await cancelApp(session.profile).catch(() => {});
    session.state = "ended";
    if (!keepRecord) this.sessions.delete(session.id);
    return sessionView(session);
  }
}

function profileAddress(address) {
  // moonlight-common-c accepts a literal IPv6 address without URL brackets.
  return address;
}
