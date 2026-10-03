import test from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";

import { normalizeMacAddress, normalizeWakeOnLanConfiguration, sendWakeOnLan, wakeOnLanPacket, wakeOnLanSummary } from "../src/wol.js";

test("normalizes Wake-on-LAN configuration without exposing the full MAC in summaries", () => {
  assert.equal(normalizeMacAddress("00-D8-61-50-BF-75"), "00:d8:61:50:bf:75");
  const configuration = normalizeWakeOnLanConfiguration({ macAddress: "00d8.6150.bf75", broadcastAddress: "192.168.15.255", port: 7 });
  assert.deepEqual(configuration, { macAddress: "00:d8:61:50:bf:75", broadcastAddress: "192.168.15.255", port: 7 });
  assert.deepEqual(wakeOnLanSummary(configuration), { configured: true, macAddressSuffix: "50:bf:75", broadcastAddress: "192.168.15.255", port: 7 });
  assert.deepEqual(wakeOnLanSummary(), { configured: false });
});

test("creates the standard six-byte prefix and sixteen MAC repetitions", () => {
  const packet = wakeOnLanPacket("00:d8:61:50:bf:75");
  assert.equal(packet.length, 102);
  assert.ok(packet.subarray(0, 6).every((value) => value === 0xff));
  for (let offset = 6; offset < packet.length; offset += 6) {
    assert.equal(packet.subarray(offset, offset + 6).toString("hex"), "00d86150bf75");
  }
});

test("rejects malformed MAC, broadcast, and port values", () => {
  assert.throws(() => normalizeMacAddress("not-a-mac"), /12 hexadecimal digits/);
  assert.throws(() => normalizeWakeOnLanConfiguration({ macAddress: "00:d8:61:50:bf:75", broadcastAddress: "win-302.local" }), /IPv4/);
  assert.throws(() => normalizeWakeOnLanConfiguration({ macAddress: "00:d8:61:50:bf:75", port: 0 }), /between 1 and 65535/);
});

test("sends the magic packet over local UDP", async (t) => {
  const receiver = dgram.createSocket("udp4");
  t.after(() => receiver.close());
  const packet = await new Promise((resolve, reject) => {
    receiver.once("error", reject);
    receiver.once("message", resolve);
    receiver.bind(0, "127.0.0.1", async () => {
      try {
        const port = receiver.address().port;
        await sendWakeOnLan({ macAddress: "00:d8:61:50:bf:75", broadcastAddress: "127.0.0.1", port }, { attempts: 1 });
      } catch (error) {
        reject(error);
      }
    });
  });
  assert.equal(packet.toString("hex"), wakeOnLanPacket("00:d8:61:50:bf:75").toString("hex"));
});
