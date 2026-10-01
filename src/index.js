#!/usr/bin/env node

import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import packageInfo from "../package.json" with { type: "json" };

import { getServerInfo, hostUrls, normalizeHost } from "./host.js";
import { getAuthenticatedHostStatus, listApps, PairingManager } from "./pairing.js";
import { ACCESS_MODES, decodePermissions, preflightAccess } from "./permissions.js";
import { DESKTOP_APP_ID, SessionManager, rgbToPng } from "./session.js";
import { applicationDataDirectory, defaultBridgePath } from "./paths.js";
import { ProfileStore } from "./store.js";
import { cropRgb, diffRgb, findTemplate } from "./vision.js";
import { recognizePng } from "./ocr.js";
import { resolveHotkey, resolveVirtualKey } from "./keys.js";

function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error) {
  return {
    isError: true,
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
  };
}

function safe(handler) {
  return async (args) => {
    try {
      return json(await handler(args));
    } catch (error) {
      console.error(error);
      return errorResult(error);
    }
  };
}

function safeResult(handler) {
  return async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      console.error(error);
      return errorResult(error);
    }
  };
}

async function ocrInput({ sessionId, snapshotId, maxAgeMs, region }) {
  const suppliedRegion = Object.values(region).some((value) => value !== undefined);
  if (suppliedRegion && Object.values(region).some((value) => value === undefined)) {
    throw new Error("region_x, region_y, region_width, and region_height must be supplied together.");
  }
  const capture = snapshotId ? null : await sessions.capture(sessionId, maxAgeMs);
  const snapshot = sessions.getSnapshot(sessionId, snapshotId ?? capture.snapshotId);
  const image = suppliedRegion
    ? cropRgb(snapshot, { x: region.x, y: region.y, width: region.width, height: region.height })
    : snapshot;
  return { snapshot, region: suppliedRegion ? { x: region.x, y: region.y, width: region.width, height: region.height } : null, png: rgbToPng(image).png };
}

function textMatches(layout, query) {
  const needle = query.normalize("NFKC").toLocaleLowerCase();
  const matches = layout.lines.filter((line) => line.text.normalize("NFKC").toLocaleLowerCase().includes(needle));
  return matches.length > 0
    ? matches.map((line) => ({ kind: "line", ...line }))
    : layout.words
      .filter((word) => word.text.normalize("NFKC").toLocaleLowerCase().includes(needle))
      .map((word) => ({ kind: "word", ...word }));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const store = new ProfileStore();
const pairing = new PairingManager(store);
const sessions = new SessionManager();
const server = new McpServer({
  name: "moonlight-desktop-mcp",
  version: packageInfo.version,
}, {
  instructions: "Local Apollo/Moonlight Desktop computer-use MCP. Use Desktop-first visual interaction: check session_preflight before launch; session_start controls only a new virtual Desktop and never takes over an existing stream. Capture before coordinate input, prefer OCR/template locations over guesses, verify every meaningful action visually, and session_stop when finished. Use provider_app_start only when the user explicitly requests an Apollo-registered provider app. Pairing returns a one-time PIN and Apollo Web UI URL; never expose local profile keys.",
});

server.registerTool("runtime_status", {
  title: "Check MCP version and local readiness",
  description: "Reports this MCP's installed version, local platform, and whether its native Moonlight bridge is built. It sends no host request and does not change installations, profiles, or sessions.",
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(async () => {
  const bridgePath = defaultBridgePath();
  return {
    name: packageInfo.name,
    version: packageInfo.version,
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    dataDirectory: applicationDataDirectory(),
    nativeBridge: { ready: existsSync(bridgePath), path: bridgePath },
    updateCheck: "Run npm run check:updates for dependency guidance, or npm run check:updates -- --remote from a Git checkout to compare it with its remote without changing the checkout.",
    updateInstructions: "Review docs/INSTALL.md before applying an update; updates must rebuild the native bridge and retain local pairing data.",
  };
}));

server.registerTool("host_status", {
  title: "Check an Apollo host",
  description: "Read the public GameStream serverinfo response. This never launches an app, pairs, or sends input.",
  inputSchema: { host: z.string().min(1).describe("Host name or address, optionally with a GameStream HTTP port.") },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(async ({ host: hostInput }) => {
  const host = normalizeHost(hostInput);
  const info = await getServerInfo(host);
  const urls = hostUrls({ ...host, httpsPort: info.httpsPort });
  return {
    host: info.hostname || host.address,
    address: host.address,
    gameStreamHttpUrl: urls.http,
    apolloWebUrl: urls.web,
    appVersion: info.appVersion,
    state: info.state,
    currentGame: info.currentGame,
    codecModeSupport: info.codecModeSupport,
    note: "PairStatus is only meaningful when the request presents a paired client identity; this read-only check does not.",
  };
}));

server.registerTool("pairing_begin", {
  title: "Pair a dedicated Moonlight MCP client",
  description: "Starts standard Apollo/GameStream pairing. Returns a four-digit PIN and the Apollo Web UI URL where the invoker can approve it. Generates a new local client identity; no existing Moonlight profile is modified.",
  inputSchema: {
    host: z.string().min(1).describe("Host name or address, optionally with a GameStream HTTP port."),
    device_name: z.string().min(1).max(64).optional().describe("Friendly name shown in Apollo. Defaults to Moonlight MCP."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(async ({ host: hostInput, device_name: deviceName }) => {
  const host = normalizeHost(hostInput);
  return pairing.begin(host, deviceName);
}));

server.registerTool("pairing_status", {
  title: "Check a pending pairing",
  description: "Checks whether an Apollo PIN approval completed the current pairing handshake.",
  inputSchema: { pairing_id: z.string().min(1) },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(({ pairing_id: pairingId }) => pairing.status(pairingId)));

server.registerTool("pairing_cancel", {
  title: "Cancel a pending pairing",
  description: "Stops this MCP process from waiting for an Apollo PIN approval. It does not modify existing paired Apollo clients.",
  inputSchema: { pairing_id: z.string().min(1) },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(({ pairing_id: pairingId }) => pairing.cancel(pairingId)));

server.registerTool("profiles_list", {
  title: "List local MCP identities",
  description: "Lists local Moonlight MCP profiles without ever returning client certificates or private keys.",
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(async () => ({
  profiles: (await store.readAll()).map(({ id, deviceName, clientId, host, createdAt }) => ({
    id,
    deviceName,
    clientId,
    host: `${host.address}:${host.port}`,
    createdAt,
  })),
})));

server.registerTool("apps_list", {
  title: "List Apollo apps",
  description: "Lists apps through the selected paired MCP identity using mutual TLS. If Apollo has not granted List Apps, returns the exact permission request and Apollo Web UI URL. This never launches an app.",
  inputSchema: { profile_id: z.string().min(1) },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(async ({ profile_id: profileId }) => {
  const profile = await store.find(profileId);
  const status = await getAuthenticatedHostStatus(profile);
  const access = preflightAccess(status.permission, "read_only", {
    apolloWebUrl: hostUrls(profile.host).web,
    deviceName: profile.deviceName,
  });
  if (!access.ready) return { profileId, ready: false, access, apps: [] };
  return { profileId, apps: await listApps(profile) };
}));

server.registerTool("profile_status", {
  title: "Check paired identity permissions",
  description: "Reads the selected identity's authenticated Apollo permissions, decodes every granted and missing permission, and preflights visual computer use. This never launches an app or sends input.",
  inputSchema: { profile_id: z.string().min(1) },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(async ({ profile_id: profileId }) => {
  const profile = await store.find(profileId);
  const status = await getAuthenticatedHostStatus(profile);
  const apolloWebUrl = hostUrls(profile.host).web;
  return {
    profileId,
    ...status,
    permissions: decodePermissions(status.permission),
    computerUse: preflightAccess(status.permission, "computer_use", { apolloWebUrl, deviceName: profile.deviceName }),
  };
}));

server.registerTool("session_preflight", {
  title: "Check session permissions",
  description: "Checks whether Apollo granted exactly the permissions required for an intended future session. When anything is missing, returns a user-action request with the Apollo Web UI URL and only the missing toggles; it never changes host permissions itself.",
  inputSchema: {
    profile_id: z.string().min(1),
    mode: z.enum(Object.keys(ACCESS_MODES)).default("computer_use").describe("The planned session capability."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(async ({ profile_id: profileId, mode }) => {
  const profile = await store.find(profileId);
  const status = await getAuthenticatedHostStatus(profile);
  return {
    profileId,
    hostname: status.hostname,
    permissionMask: status.permission,
    access: preflightAccess(status.permission, mode, {
      apolloWebUrl: hostUrls(profile.host).web,
      deviceName: profile.deviceName,
    }),
  };
}));

async function startSession(profileId, { appId, appName, width, height, fps, bitrate }) {
  const profile = await store.find(profileId);
  const status = await getAuthenticatedHostStatus(profile);
  const access = preflightAccess(status.permission, "computer_use", {
    apolloWebUrl: hostUrls(profile.host).web,
    deviceName: profile.deviceName,
  });
  if (!access.ready) return { profileId, started: false, access };
  return { started: true, ...(await sessions.start(profile, { appId, appName, width, height, fps, bitrate })) };
}

server.registerTool("session_start", {
  title: "Start a headless Desktop session",
  description: "Launches Apollo's Desktop app and establishes a local Moonlight video/input session. This is the default and normal entry point for computer use: inspect the visible desktop, then click or type like a user would. It first checks required permissions and never takes over an existing running Apollo app.",
  inputSchema: {
    profile_id: z.string().min(1),
    width: z.number().int().min(320).max(3840).default(1280),
    height: z.number().int().min(240).max(2160).default(720),
    fps: z.number().int().min(10).max(60).default(30),
    bitrate_kbps: z.number().int().min(1_000).max(50_000).default(10_000),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(({ profile_id: profileId, width, height, fps, bitrate_kbps: bitrate }) => startSession(profileId, {
  appId: DESKTOP_APP_ID,
  appName: "Desktop",
  width,
  height,
  fps,
  bitrate,
})));

server.registerTool("provider_app_start", {
  title: "Start a specific Apollo provider app",
  description: "Explicit provider-app path. Use this only when the user expressly requests an Apollo/Moonlight registered app rather than visual Desktop computer use. It never takes over an existing running Apollo app.",
  inputSchema: {
    profile_id: z.string().min(1),
    app_id: z.number().int().positive().describe("Explicit Apollo provider app ID."),
    app_name: z.string().min(1).max(128).describe("Name of the explicitly requested provider app."),
    width: z.number().int().min(320).max(3840).default(1280),
    height: z.number().int().min(240).max(2160).default(720),
    fps: z.number().int().min(10).max(60).default(30),
    bitrate_kbps: z.number().int().min(1_000).max(50_000).default(10_000),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(({ profile_id: profileId, app_id: appId, app_name: appName, width, height, fps, bitrate_kbps: bitrate }) => startSession(profileId, {
  appId,
  appName,
  width,
  height,
  fps,
  bitrate,
})));

server.registerTool("session_status", {
  title: "Check a headless session",
  description: "Returns local Moonlight transport state and the timestamp of its newest video frame. This never sends remote input.",
  inputSchema: { session_id: z.string().min(1) },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(({ session_id: sessionId }) => sessions.status(sessionId)));

server.registerTool("screen_capture", {
  title: "Capture the current remote desktop",
  description: "Returns the latest decoded Moonlight frame as a PNG image. A cached frame is used only when it is at most max_age_ms old; otherwise the bridge requests a new video frame and waits for it. The 500 ms default is intended for visual computer use.",
  inputSchema: {
    session_id: z.string().min(1),
    max_age_ms: z.number().int().min(100).max(10_000).default(500),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safeResult(async ({ session_id: sessionId, max_age_ms: maxAgeMs }) => {
  const capture = await sessions.capture(sessionId, maxAgeMs);
  return {
    content: [
      { type: "image", data: capture.png.toString("base64"), mimeType: "image/png" },
      { type: "text", text: JSON.stringify({ sessionId, snapshotId: capture.snapshotId, width: capture.width, height: capture.height, frameSequence: capture.frameSequence, frameCapturedAt: capture.frameCapturedAt }) },
    ],
  };
}));

server.registerTool("screen_crop", {
  title: "Crop an active Desktop screenshot",
  description: "Returns a PNG crop in the active session's capture-space coordinates. Supply a snapshot ID from screen_capture to crop the exact observed image, or omit it to capture a current frame first.",
  inputSchema: {
    session_id: z.string().min(1),
    snapshot_id: z.string().min(1).optional(),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1).max(3840),
    height: z.number().int().min(1).max(2160),
    max_age_ms: z.number().int().min(100).max(10_000).default(500),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safeResult(async ({ session_id: sessionId, snapshot_id: snapshotId, x, y, width, height, max_age_ms: maxAgeMs }) => {
  const capture = snapshotId ? null : await sessions.capture(sessionId, maxAgeMs);
  const snapshot = sessions.getSnapshot(sessionId, snapshotId ?? capture.snapshotId);
  const crop = cropRgb(snapshot, { x, y, width, height });
  return {
    content: [
      { type: "image", data: rgbToPng(crop).png.toString("base64"), mimeType: "image/png" },
      { type: "text", text: JSON.stringify({ sessionId, snapshotId: snapshot.id, crop: { x, y, width, height }, frameSequence: snapshot.frameSequence }) },
    ],
  };
}));

server.registerTool("screen_diff", {
  title: "Compare Desktop screenshots",
  description: "Compares a retained baseline screenshot with another retained or current screenshot. Returns the proportion and bounding box of material pixel changes in capture-space coordinates.",
  inputSchema: {
    session_id: z.string().min(1),
    baseline_snapshot_id: z.string().min(1),
    comparison_snapshot_id: z.string().min(1).optional(),
    pixel_threshold: z.number().int().min(0).max(255).default(32),
    max_age_ms: z.number().int().min(100).max(10_000).default(500),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(async ({ session_id: sessionId, baseline_snapshot_id: baselineSnapshotId, comparison_snapshot_id: comparisonSnapshotId, pixel_threshold: pixelThreshold, max_age_ms: maxAgeMs }) => {
  const baseline = sessions.getSnapshot(sessionId, baselineSnapshotId);
  const capture = comparisonSnapshotId ? null : await sessions.capture(sessionId, maxAgeMs);
  const comparison = sessions.getSnapshot(sessionId, comparisonSnapshotId ?? capture.snapshotId);
  return {
    sessionId,
    baselineSnapshotId: baseline.id,
    comparisonSnapshotId: comparison.id,
    comparison: diffRgb(baseline, comparison, { pixelThreshold }),
  };
}));

server.registerTool("session_wait_for_change", {
  title: "Wait for a material Desktop visual change",
  description: "Waits for the active Desktop stream to differ materially from a retained screenshot, then returns the resulting frame and changed region. Use after actions that open a window, load content, or change a setting. It ignores tiny cursor/compression changes by default.",
  inputSchema: {
    session_id: z.string().min(1),
    baseline_snapshot_id: z.string().min(1).optional(),
    timeout_ms: z.number().int().min(250).max(30_000).default(5_000),
    min_changed_fraction: z.number().positive().max(1).default(0.003),
    pixel_threshold: z.number().int().min(0).max(255).default(32),
    region_x: z.number().int().min(0).optional(),
    region_y: z.number().int().min(0).optional(),
    region_width: z.number().int().min(1).max(3840).optional(),
    region_height: z.number().int().min(1).max(2160).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safeResult(async ({ session_id: sessionId, baseline_snapshot_id: baselineSnapshotId, timeout_ms: timeoutMs, min_changed_fraction: minChangedFraction, pixel_threshold: pixelThreshold, region_x: x, region_y: y, region_width: width, region_height: height }) => {
  const suppliedRegion = [x, y, width, height].some((value) => value !== undefined);
  if (suppliedRegion && [x, y, width, height].some((value) => value === undefined)) {
    throw new Error("region_x, region_y, region_width, and region_height must be supplied together.");
  }
  const region = suppliedRegion ? { x, y, width, height } : undefined;
  const result = await sessions.waitForVisualChange(sessionId, { baselineSnapshotId, timeoutMs, minChangedFraction, pixelThreshold, region });
  return {
    content: [
      { type: "image", data: rgbToPng(result.current).png.toString("base64"), mimeType: "image/png" },
      { type: "text", text: JSON.stringify({
        sessionId,
        changed: result.changed,
        timedOut: result.timedOut ?? false,
        baselineSnapshotId: result.baseline.id,
        currentSnapshotId: result.current.id,
        frameSequence: result.current.frameSequence,
        comparison: result.comparison,
        region: region ?? null,
      }) },
    ],
  };
}));

server.registerTool("screen_template_create", {
  title: "Create a reusable visual template",
  description: "Stores a cropped region from a retained screenshot as a session-local visual template. Use it with screen_find_template to locate the same icon, control, or image in later Desktop frames.",
  inputSchema: {
    session_id: z.string().min(1),
    snapshot_id: z.string().min(1),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(2).max(512),
    height: z.number().int().min(2).max(512),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(({ session_id: sessionId, snapshot_id: snapshotId, x, y, width, height }) => {
  const snapshot = sessions.getSnapshot(sessionId, snapshotId);
  const template = sessions.createTemplate(sessionId, snapshotId, cropRgb(snapshot, { x, y, width, height }));
  return { sessionId, templateId: template.id, width: template.width, height: template.height, sourceSnapshotId: template.sourceSnapshotId };
}));

server.registerTool("screen_find_template", {
  title: "Find a visual template on the current Desktop",
  description: "Finds a session-local visual template in a current Desktop screenshot and returns its capture-space bounding box and similarity score. The result is deterministic pixel matching; use screen_capture for semantic interpretation.",
  inputSchema: {
    session_id: z.string().min(1),
    template_id: z.string().min(1),
    min_score: z.number().min(0).max(1).default(0.88),
    search_x: z.number().int().min(0).optional(),
    search_y: z.number().int().min(0).optional(),
    search_width: z.number().int().min(1).max(3840).optional(),
    search_height: z.number().int().min(1).max(2160).optional(),
    max_age_ms: z.number().int().min(100).max(10_000).default(500),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(async ({ session_id: sessionId, template_id: templateId, min_score: minScore, search_x: searchX, search_y: searchY, search_width: searchWidth, search_height: searchHeight, max_age_ms: maxAgeMs }) => {
  const capture = await sessions.capture(sessionId, maxAgeMs);
  const snapshot = sessions.getSnapshot(sessionId, capture.snapshotId);
  const template = sessions.getTemplate(sessionId, templateId);
  const suppliedRegion = [searchX, searchY, searchWidth, searchHeight].some((value) => value !== undefined);
  if (suppliedRegion && [searchX, searchY, searchWidth, searchHeight].some((value) => value === undefined)) {
    throw new Error("search_x, search_y, search_width, and search_height must be supplied together.");
  }
  const match = findTemplate(snapshot, template, {
    searchRegion: suppliedRegion ? { x: searchX, y: searchY, width: searchWidth, height: searchHeight } : undefined,
  });
  return { sessionId, snapshotId: snapshot.id, templateId, found: match !== null && match.score >= minScore, match, minScore };
}));

server.registerTool("screen_ocr", {
  title: "Read visible Desktop text with OCR",
  description: "Runs local OCR on a current or retained Desktop screenshot and returns recognized text plus capture-space line and word boxes. The first use of a language may download its OCR data on the MCP invoker machine; no Windows software is installed.",
  inputSchema: {
    session_id: z.string().min(1),
    snapshot_id: z.string().min(1).optional(),
    language: z.string().min(2).max(64).default("eng").describe("Tesseract code, for example eng, por, or eng+por."),
    min_confidence: z.number().min(0).max(100).default(40),
    max_results: z.number().int().min(1).max(500).default(200),
    region_x: z.number().int().min(0).optional(),
    region_y: z.number().int().min(0).optional(),
    region_width: z.number().int().min(1).max(3840).optional(),
    region_height: z.number().int().min(1).max(2160).optional(),
    max_age_ms: z.number().int().min(100).max(10_000).default(500),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(async ({ session_id: sessionId, snapshot_id: snapshotId, language, min_confidence: minConfidence, max_results: maxResults, region_x: x, region_y: y, region_width: width, region_height: height, max_age_ms: maxAgeMs }) => {
  const input = await ocrInput({ sessionId, snapshotId, maxAgeMs, region: { x, y, width, height } });
  const layout = await recognizePng(input.png, { language, offsetX: input.region?.x ?? 0, offsetY: input.region?.y ?? 0, minConfidence });
  return {
    sessionId,
    snapshotId: input.snapshot.id,
    frameSequence: input.snapshot.frameSequence,
    region: input.region,
    language,
    text: layout.text,
    lines: layout.lines.slice(0, maxResults),
    words: layout.words.slice(0, maxResults),
    truncated: layout.lines.length > maxResults || layout.words.length > maxResults,
  };
}));

server.registerTool("screen_find_text", {
  title: "Locate visible Desktop text",
  description: "Runs local OCR and finds matching visible text. Returns capture-space boxes suitable for session_mouse_click_at. Searches full recognized lines first, then individual words when no line matches.",
  inputSchema: {
    session_id: z.string().min(1),
    query: z.string().min(1).max(256),
    snapshot_id: z.string().min(1).optional(),
    language: z.string().min(2).max(64).default("eng"),
    min_confidence: z.number().min(0).max(100).default(40),
    max_results: z.number().int().min(1).max(100).default(20),
    region_x: z.number().int().min(0).optional(),
    region_y: z.number().int().min(0).optional(),
    region_width: z.number().int().min(1).max(3840).optional(),
    region_height: z.number().int().min(1).max(2160).optional(),
    max_age_ms: z.number().int().min(100).max(10_000).default(500),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(async ({ session_id: sessionId, query, snapshot_id: snapshotId, language, min_confidence: minConfidence, max_results: maxResults, region_x: x, region_y: y, region_width: width, region_height: height, max_age_ms: maxAgeMs }) => {
  const input = await ocrInput({ sessionId, snapshotId, maxAgeMs, region: { x, y, width, height } });
  const layout = await recognizePng(input.png, { language, offsetX: input.region?.x ?? 0, offsetY: input.region?.y ?? 0, minConfidence });
  const matches = textMatches(layout, query).slice(0, maxResults);
  return { sessionId, snapshotId: input.snapshot.id, frameSequence: input.snapshot.frameSequence, query, language, matches, found: matches.length > 0 };
}));

server.registerTool("screen_wait_for_text", {
  title: "Wait for visible Desktop text",
  description: "Polls local OCR until requested text is visibly present or a timeout expires. Use for menus, completion notices, and dialogs; successful matches include capture-space boxes for the next visual action.",
  inputSchema: {
    session_id: z.string().min(1),
    query: z.string().min(1).max(256),
    language: z.string().min(2).max(64).default("eng"),
    min_confidence: z.number().min(0).max(100).default(40),
    timeout_ms: z.number().int().min(500).max(60_000).default(10_000),
    poll_interval_ms: z.number().int().min(250).max(10_000).default(1_000),
    region_x: z.number().int().min(0).optional(),
    region_y: z.number().int().min(0).optional(),
    region_width: z.number().int().min(1).max(3840).optional(),
    region_height: z.number().int().min(1).max(2160).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safeResult(async ({ session_id: sessionId, query, language, min_confidence: minConfidence, timeout_ms: timeoutMs, poll_interval_ms: pollIntervalMs, region_x: x, region_y: y, region_width: width, region_height: height }) => {
  const deadline = Date.now() + timeoutMs;
  let latest;
  let matches = [];
  do {
    latest = await ocrInput({ sessionId, maxAgeMs: 100, region: { x, y, width, height } });
    const layout = await recognizePng(latest.png, { language, offsetX: latest.region?.x ?? 0, offsetY: latest.region?.y ?? 0, minConfidence });
    matches = textMatches(layout, query);
    if (matches.length > 0) {
      return {
        content: [
          { type: "image", data: latest.png.toString("base64"), mimeType: "image/png" },
          { type: "text", text: JSON.stringify({ sessionId, found: true, query, language, snapshotId: latest.snapshot.id, frameSequence: latest.snapshot.frameSequence, matches: matches.slice(0, 20) }) },
        ],
      };
    }
    if (Date.now() < deadline) await sleep(Math.min(pollIntervalMs, deadline - Date.now()));
  } while (Date.now() < deadline);
  return {
    content: [
      { type: "image", data: latest.png.toString("base64"), mimeType: "image/png" },
      { type: "text", text: JSON.stringify({ sessionId, found: false, timedOut: true, query, language, snapshotId: latest.snapshot.id, frameSequence: latest.snapshot.frameSequence, matches: [] }) },
    ],
  };
}));

server.registerTool("session_mouse_move", {
  title: "Move the remote mouse",
  description: "Queues an absolute mouse position over the active encrypted Moonlight input channel. Coordinates are in the current screen_capture pixel space.",
  inputSchema: { session_id: z.string().min(1), x: z.number().int().min(0).max(32767), y: z.number().int().min(0).max(32767) },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(({ session_id: sessionId, x, y }) => {
  const session = sessions.find(sessionId);
  if (x >= session.width || y >= session.height) throw new Error(`Mouse coordinates must fit the ${session.width}x${session.height} current capture.`);
  sessions.send(sessionId, `mouse ${x} ${y} ${session.width} ${session.height}`);
  return { sessionId, queued: "mouse_move", x, y };
}));

server.registerTool("session_mouse_click", {
  title: "Click the remote mouse",
  description: "Queues a complete mouse click over the active encrypted Moonlight input channel, holding the button briefly so the Windows desktop can recognise it reliably.",
  inputSchema: {
    session_id: z.string().min(1),
    button: z.enum(["left", "middle", "right"]).default("left"),
    count: z.number().int().min(1).max(2).default(1),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(async ({ session_id: sessionId, button, count }) => {
  for (let index = 0; index < count; index++) {
    sessions.send(sessionId, `button ${button} down`);
    await new Promise((resolve) => setTimeout(resolve, 40));
    sessions.send(sessionId, `button ${button} up`);
    // Windows recognises a real double-click as two complete clicks separated
    // by a small interval; consecutive encrypted packets can otherwise land
    // too closely together for the host shell to classify them correctly.
    if (index + 1 < count) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { sessionId, queued: "mouse_click", button, count };
}));

server.registerTool("session_mouse_click_at", {
  title: "Move to and click a remote coordinate",
  description: "Moves to a capture-space coordinate, lets the remote desktop observe the position, then sends a complete click. Prefer this atomic visual-computer-use action over separate move and click calls when clicking a target found in screen_capture.",
  inputSchema: {
    session_id: z.string().min(1),
    x: z.number().int().min(0).max(32767),
    y: z.number().int().min(0).max(32767),
    button: z.enum(["left", "middle", "right"]).default("left"),
    count: z.number().int().min(1).max(2).default(1),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(async ({ session_id: sessionId, x, y, button, count }) => {
  const session = sessions.find(sessionId);
  if (x >= session.width || y >= session.height) throw new Error(`Mouse coordinates must fit the ${session.width}x${session.height} current capture.`);
  sessions.send(sessionId, `mouse ${x} ${y} ${session.width} ${session.height}`);
  await new Promise((resolve) => setTimeout(resolve, 40));
  for (let index = 0; index < count; index++) {
    sessions.send(sessionId, `button ${button} down`);
    await new Promise((resolve) => setTimeout(resolve, 40));
    sessions.send(sessionId, `button ${button} up`);
    if (index + 1 < count) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { sessionId, queued: "mouse_click_at", x, y, button, count };
}));

server.registerTool("session_mouse_drag", {
  title: "Drag the remote mouse",
  description: "Moves to a starting capture-space coordinate, holds the selected mouse button, sends interpolated absolute positions over the encrypted Moonlight input channel, and releases the button. Use screen_capture before and after the drag.",
  inputSchema: {
    session_id: z.string().min(1),
    start_x: z.number().int().min(0).max(32767),
    start_y: z.number().int().min(0).max(32767),
    end_x: z.number().int().min(0).max(32767),
    end_y: z.number().int().min(0).max(32767),
    button: z.enum(["left", "middle", "right"]).default("left"),
    duration_ms: z.number().int().min(50).max(5_000).default(500),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(async ({ session_id: sessionId, start_x: startX, start_y: startY, end_x: endX, end_y: endY, button, duration_ms: durationMs }) => {
  const session = sessions.find(sessionId);
  for (const [label, x, y] of [["start", startX, startY], ["end", endX, endY]]) {
    if (x >= session.width || y >= session.height) throw new Error(`The ${label} coordinate must fit the ${session.width}x${session.height} current capture.`);
  }
  const steps = Math.min(60, Math.max(2, Math.ceil(durationMs / 30)));
  sessions.send(sessionId, `mouse ${startX} ${startY} ${session.width} ${session.height}`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  sessions.send(sessionId, `button ${button} down`);
  // Let the host observe the button-down before position packets start. This
  // matters for desktop canvases, where a down/move/up burst can otherwise be
  // classified as a hover rather than a drag.
  await new Promise((resolve) => setTimeout(resolve, 50));
  try {
    for (let step = 1; step <= steps; step++) {
      const ratio = step / steps;
      const x = Math.round(startX + (endX - startX) * ratio);
      const y = Math.round(startY + (endY - startY) * ratio);
      sessions.send(sessionId, `mouse ${x} ${y} ${session.width} ${session.height}`);
      if (step < steps) await new Promise((resolve) => setTimeout(resolve, durationMs / steps));
    }
  } finally {
    sessions.send(sessionId, `button ${button} up`);
  }
  return { sessionId, queued: "mouse_drag", start: { x: startX, y: startY }, end: { x: endX, y: endY }, button, durationMs };
}));

server.registerTool("session_scroll", {
  title: "Scroll the remote viewport",
  description: "Queues a high-resolution vertical wheel event over the encrypted Moonlight input channel. Amount is in 1/120-wheel-click units; positive is up and negative is down.",
  inputSchema: { session_id: z.string().min(1), amount: z.number().int().min(-32768).max(32767) },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(({ session_id: sessionId, amount }) => {
  sessions.send(sessionId, `scroll ${amount}`);
  return { sessionId, queued: "scroll", amount };
}));

server.registerTool("session_type", {
  title: "Type remote UTF-8 text",
  description: "Queues UTF-8 text through Moonlight's encrypted text-input event. Use screen_capture to verify the visible result.",
  inputSchema: { session_id: z.string().min(1), text: z.string().min(1).max(4096) },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(({ session_id: sessionId, text: typedText }) => {
  sessions.send(sessionId, `text ${Buffer.from(typedText, "utf8").toString("hex")}`);
  return { sessionId, queued: "text", byteLength: Buffer.byteLength(typedText, "utf8") };
}));

server.registerTool("session_key", {
  title: "Send a remote virtual key",
  description: "Queues a Windows virtual-key event through Moonlight. Use action down/up for shortcuts; modifiers is a Moonlight bitmask: Shift 1, Ctrl 2, Alt 4, Meta 8, Extended 16.",
  inputSchema: {
    session_id: z.string().min(1),
    virtual_key: z.number().int().min(0).max(65535),
    action: z.enum(["down", "up"]),
    modifiers: z.number().int().min(0).max(31).default(0),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(({ session_id: sessionId, virtual_key: virtualKey, action, modifiers }) => {
  sessions.send(sessionId, `key ${virtualKey} ${action} ${modifiers}`);
  return { sessionId, queued: "key", virtualKey, action, modifiers };
}));

server.registerTool("session_key_press", {
  title: "Press and release a remote virtual key",
  description: "Sends one complete Windows virtual-key press through Moonlight. Use session_shortcut for multi-key chords such as Ctrl+Z, and session_key only when an individual key must remain held.",
  inputSchema: {
    session_id: z.string().min(1),
    virtual_key: z.number().int().min(0).max(65535),
    modifiers: z.number().int().min(0).max(31).default(0),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(async ({ session_id: sessionId, virtual_key: virtualKey, modifiers }) => {
  sessions.send(sessionId, `key ${virtualKey} down ${modifiers}`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  sessions.send(sessionId, `key ${virtualKey} up ${modifiers}`);
  return { sessionId, queued: "key_press", virtualKey, modifiers };
}));

server.registerTool("session_key_press_named", {
  title: "Press a named Windows key",
  description: "Presses and releases a named Windows key such as ENTER, ESCAPE, TAB, SPACE, F5, LEFT, or WINDOWS. Prefer this over raw virtual-key codes for ordinary visual computer use.",
  inputSchema: {
    session_id: z.string().min(1),
    key: z.string().min(1).max(32),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(async ({ session_id: sessionId, key }) => {
  const resolved = resolveVirtualKey(key);
  sessions.send(sessionId, `key ${resolved.virtualKey} down 0`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  sessions.send(sessionId, `key ${resolved.virtualKey} up 0`);
  return { sessionId, queued: "key_press", ...resolved };
}));

server.registerTool("session_hotkey", {
  title: "Send a named Windows hotkey",
  description: "Sends a named key chord as real key-down events followed by reverse key-up events. Examples: key Z with modifiers [CTRL] for undo, key F4 with [ALT] to close a window, or key L with [WINDOWS].",
  inputSchema: {
    session_id: z.string().min(1),
    key: z.string().min(1).max(32),
    modifiers: z.array(z.enum(["SHIFT", "CTRL", "ALT", "WINDOWS", "WIN", "META"])).max(4).default([]),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(async ({ session_id: sessionId, key, modifiers }) => {
  const resolved = resolveHotkey(key, modifiers);
  for (const virtualKey of resolved.virtualKeys) {
    sessions.send(sessionId, `key ${virtualKey} down 0`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  for (const virtualKey of [...resolved.virtualKeys].reverse()) {
    sessions.send(sessionId, `key ${virtualKey} up 0`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { sessionId, queued: "hotkey", key: resolved.key, modifiers, virtualKeys: resolved.virtualKeys };
}));

server.registerTool("session_shortcut", {
  title: "Send a remote key shortcut",
  description: "Sends a chord as real key-down events in order and key-up events in reverse order. For example, [17, 90] is Ctrl+Z. This is more reliable for desktop shortcuts than encoding a modifier bit on one key event.",
  inputSchema: {
    session_id: z.string().min(1),
    virtual_keys: z.array(z.number().int().min(0).max(65535)).min(2).max(5).describe("Windows virtual-key codes in press order."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(async ({ session_id: sessionId, virtual_keys: virtualKeys }) => {
  for (const virtualKey of virtualKeys) {
    sessions.send(sessionId, `key ${virtualKey} down 0`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  for (const virtualKey of [...virtualKeys].reverse()) {
    sessions.send(sessionId, `key ${virtualKey} up 0`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { sessionId, queued: "shortcut", virtualKeys };
}));

server.registerTool("session_stop", {
  title: "Stop a headless Desktop session",
  description: "Stops the local Moonlight transport and asks Apollo to cancel the Desktop app launched by this MCP session. It does not affect unrelated existing sessions, which this prototype never takes over.",
  inputSchema: { session_id: z.string().min(1) },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, safe(async ({ session_id: sessionId }) => sessions.stop(sessionId)));

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Moonlight Desktop MCP ${packageInfo.version} started on stdio.`);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`Moonlight MCP received ${signal}; stopping owned Desktop sessions.`);
  await sessions.stopAll().catch((error) => console.error("Moonlight MCP cleanup failed:", error));
  process.exit(0);
}

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
