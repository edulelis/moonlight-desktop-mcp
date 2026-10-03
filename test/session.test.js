import test from "node:test";
import assert from "node:assert/strict";

import { HEADLESS_DESKTOP_CHANNEL, HEADLESS_PROVIDER_APP_CHANNEL, SessionManager, desktopChannelNextAction, desktopStreamSettings, ppmToPng, sessionView, transportSessionView } from "../src/session.js";

test("converts an RGB PPM frame to a PNG image", () => {
  const ppm = Buffer.concat([
    Buffer.from("P6\n2 1\n255\n"),
    Buffer.from([255, 0, 0, 0, 255, 0]),
  ]);
  const image = ppmToPng(ppm);

  assert.equal(image.width, 2);
  assert.equal(image.height, 1);
  assert.equal(image.png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("uses full HD for Desktop sessions and provides a low-bandwidth alternative", () => {
  assert.deepEqual(desktopStreamSettings(), {
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 20_000,
  });
  assert.deepEqual(desktopStreamSettings({ streamProfile: "low_bandwidth" }), {
    width: 1280,
    height: 720,
    fps: 30,
    bitrate: 8_000,
  });
  assert.deepEqual(desktopStreamSettings({
    streamProfile: "low_bandwidth",
    width: 1024,
    bitrate: 6_000,
  }), {
    width: 1024,
    height: 720,
    fps: 30,
    bitrate: 6_000,
  });
  assert.throws(() => desktopStreamSettings({ streamProfile: "unknown" }), /Unknown Desktop stream profile/);
});

test("labels session status with its dedicated remote target", () => {
  const view = sessionView({
    id: "session-1",
    profileId: "profile-1",
    profile: {
      id: "profile-1",
      deviceName: "Example remote desktop",
      host: { address: "remote.example.test", port: 47989 },
    },
    appId: 881448767,
    appName: "Desktop",
    state: "active",
    width: 1280,
    height: 720,
    fps: 30,
    frameSequence: 7,
    frameCapturedAt: "2026-10-03T12:00:00.000Z",
    lastEvent: "frame",
    visualBaselineStable: true,
  });

  assert.deepEqual(view.channel, HEADLESS_DESKTOP_CHANNEL);
  assert.deepEqual(view.target, {
    profileId: "profile-1",
    deviceName: "Example remote desktop",
    host: { address: "remote.example.test", port: 47989 },
  });
});

test("labels provider-app sessions without claiming they are Desktop sessions", () => {
  const view = sessionView({
    id: "session-2",
    profileId: "profile-2",
    profile: {
      id: "profile-2",
      deviceName: "Example provider app",
      host: { address: "remote.example.test", port: 47989 },
    },
    appId: 42,
    appName: "Example app",
    state: "active",
    width: 1280,
    height: 720,
    fps: 30,
    frameSequence: 7,
    frameCapturedAt: "2026-10-03T12:00:00.000Z",
    lastEvent: "frame",
    visualBaselineStable: true,
  });

  assert.deepEqual(view.channel, HEADLESS_PROVIDER_APP_CHANNEL);
  assert.equal(view.channel.inputTarget, "remote_provider_app");
});

test("exposes transport occupancy without leaking provider-app details", () => {
  const occupancy = transportSessionView({
    id: "session-3",
    profileId: "profile-3",
    profile: {
      id: "profile-3",
      deviceName: "Example provider app",
      host: { address: "remote.example.test", port: 47989 },
    },
    appId: 42,
    appName: "Private provider app name",
    state: "active",
    width: 1280,
    height: 720,
    fps: 30,
    frameSequence: 7,
    frameCapturedAt: "2026-10-03T12:00:00.000Z",
    lastEvent: "frame",
    visualBaselineStable: true,
  });

  assert.deepEqual(occupancy, {
    sessionId: "session-3",
    state: "active",
    channel: HEADLESS_PROVIDER_APP_CHANNEL,
  });
});

test("gives a clear no-GUI-fallback action when the native bridge is unavailable", () => {
  const nextAction = desktopChannelNextAction({
    nativeBridgeReady: false,
    pairedTargetCount: 1,
    desktopSessions: [],
  });

  assert.match(nextAction, /channel is unavailable/i);
  assert.match(nextAction, /do not fall back to generic GUI computer use/i);
});

test("waits for a starting Desktop session rather than suggesting a capture", () => {
  const nextAction = desktopChannelNextAction({
    nativeBridgeReady: true,
    pairedTargetCount: 1,
    desktopSessions: [{ sessionId: "session-starting", state: "starting", channel: HEADLESS_DESKTOP_CHANNEL }],
    transportSessions: [{ sessionId: "session-starting", state: "starting", channel: HEADLESS_DESKTOP_CHANNEL }],
  });

  assert.match(nextAction, /Call session_status/i);
});

test("waits for an in-progress local launch preparation before suggesting a new Desktop session", () => {
  const nextAction = desktopChannelNextAction({
    nativeBridgeReady: true,
    pairedTargetCount: 1,
    desktopSessions: [],
    launchPreparationInProgress: true,
  });

  assert.match(nextAction, /launch is already being prepared/i);
  assert.doesNotMatch(nextAction, /session_preflight/i);
});

test("prefers capture for an active Desktop while its initial visual baseline is still being prepared", () => {
  const nextAction = desktopChannelNextAction({
    nativeBridgeReady: true,
    pairedTargetCount: 1,
    desktopSessions: [{ sessionId: "session-active", state: "active", channel: HEADLESS_DESKTOP_CHANNEL }],
    transportSessions: [{ sessionId: "session-active", state: "active", channel: HEADLESS_DESKTOP_CHANNEL }],
    launchPreparationInProgress: true,
  });

  assert.match(nextAction, /Call screen_capture/i);
  assert.doesNotMatch(nextAction, /launch is already being prepared/i);
});

test("reports a provider transport occupancy instead of suggesting a new Desktop session", () => {
  const nextAction = desktopChannelNextAction({
    nativeBridgeReady: true,
    pairedTargetCount: 1,
    desktopSessions: [],
    transportSessions: [{
      sessionId: "session-4",
      state: "active",
      channel: HEADLESS_PROVIDER_APP_CHANNEL,
    }],
  });

  assert.match(nextAction, /transport is occupied/i);
  assert.match(nextAction, /headless_moonlight_provider_app/);
  assert.doesNotMatch(nextAction, /session_preflight/i);
});

test("waits for a stopping transport to end instead of suggesting it become active", () => {
  const nextAction = desktopChannelNextAction({
    nativeBridgeReady: true,
    pairedTargetCount: 1,
    desktopSessions: [{ sessionId: "session-5", state: "stopping", channel: HEADLESS_DESKTOP_CHANNEL }],
    transportSessions: [{ sessionId: "session-5", state: "stopping", channel: HEADLESS_DESKTOP_CHANNEL }],
  });

  assert.match(nextAction, /is stopping/i);
  assert.match(nextAction, /Wait for it to end/i);
  assert.doesNotMatch(nextAction, /become active/i);
});

test("refuses a second local session while the transport is transitioning", async () => {
  const manager = new SessionManager({ bridgePath: "/does/not/matter" });
  manager.sessions.set("session-launching", { id: "session-launching", state: "launching" });

  await assert.rejects(
    manager.start({ id: "profile-1" }),
    /session 'session-launching' is launching/i,
  );
});

test("reserves Moonlight transport startup before the first asynchronous check and releases it after failure", async () => {
  const manager = new SessionManager({ bridgePath: "/definitely/missing/moonlight-bridge" });
  const profile = { id: "profile-1" };
  const firstStart = manager.start(profile);

  assert.equal(manager.hasStartReservation(), true);
  await assert.rejects(
    manager.start(profile),
    /launch is already being prepared/i,
  );
  await assert.rejects(firstStart);
  assert.equal(manager.hasStartReservation(), false);

  await assert.rejects(
    manager.start(profile),
    (error) => {
      assert.doesNotMatch(error.message, /launch is already being prepared/i);
      return true;
    },
  );
});
