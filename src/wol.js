import dgram from "node:dgram";
import { isIP } from "node:net";

const DEFAULT_BROADCAST_ADDRESS = "255.255.255.255";
const DEFAULT_PORT = 9;

export function normalizeMacAddress(value) {
  const compact = String(value ?? "").trim().replaceAll(/[:.\-\s]/g, "").toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(compact)) {
    throw new Error("MAC address must contain exactly 12 hexadecimal digits, for example 00:d8:61:50:bf:75.");
  }
  return compact.match(/.{2}/g).join(":");
}

export function normalizeWakeOnLanConfiguration({ macAddress, broadcastAddress = DEFAULT_BROADCAST_ADDRESS, port = DEFAULT_PORT }) {
  const normalizedBroadcastAddress = String(broadcastAddress).trim();
  if (isIP(normalizedBroadcastAddress) !== 4) {
    throw new Error("Wake-on-LAN broadcast_address must be an IPv4 address, for example 192.168.15.255.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Wake-on-LAN port must be an integer between 1 and 65535.");
  }
  return {
    macAddress: normalizeMacAddress(macAddress),
    broadcastAddress: normalizedBroadcastAddress,
    port,
  };
}

export function wakeOnLanPacket(macAddress) {
  const mac = Buffer.from(normalizeMacAddress(macAddress).replaceAll(":", ""), "hex");
  const packet = Buffer.alloc(6 + (16 * mac.length), 0xff);
  for (let offset = 6; offset < packet.length; offset += mac.length) mac.copy(packet, offset);
  return packet;
}

function sendPacket(packet, { broadcastAddress, port }) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const close = () => socket.close(() => {});
    socket.once("error", (error) => {
      close();
      reject(error);
    });
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.send(packet, port, broadcastAddress, (error) => {
          close();
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        close();
        reject(error);
      }
    });
  });
}

export async function sendWakeOnLan(configuration, { attempts = 3, intervalMs = 250 } = {}) {
  const wakeOnLan = normalizeWakeOnLanConfiguration(configuration);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw new Error("Wake-on-LAN attempts must be between 1 and 10.");
  if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 10_000) throw new Error("Wake-on-LAN interval must be between 0 and 10000 milliseconds.");
  const packet = wakeOnLanPacket(wakeOnLan.macAddress);
  for (let attempt = 0; attempt < attempts; attempt++) {
    await sendPacket(packet, wakeOnLan);
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ...wakeOnLan, attempts };
}

export function wakeOnLanSummary(configuration) {
  if (!configuration) return { configured: false };
  const wakeOnLan = normalizeWakeOnLanConfiguration(configuration);
  return {
    configured: true,
    macAddressSuffix: wakeOnLan.macAddress.slice(-8),
    broadcastAddress: wakeOnLan.broadcastAddress,
    port: wakeOnLan.port,
  };
}
