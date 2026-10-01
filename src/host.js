import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  attributeNamePrefix: "",
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
});

export function normalizeHost(input) {
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input.trim())
    ? input.trim()
    : `http://${input.trim()}`;
  const url = new URL(withScheme);

  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error("Host must be an IP address or host name, optionally with an HTTP(S) port.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Host must not include a path, query string, or fragment.");
  }

  const port = url.port ? Number(url.port) : 47989;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Host port must be between 1 and 65535.");
  }

  return { address: url.hostname, port };
}

export function displayAddress(address) {
  return address.includes(":") ? `[${address}]` : address;
}

export function hostUrls(host) {
  const address = displayAddress(host.address);
  return {
    http: `http://${address}:${host.port}`,
    https: `https://${address}:${host.httpsPort ?? host.port - 5}`,
    // Apollo/Sunshine's Web UI port is one greater than the GameStream HTTP port.
    web: `https://${address}:${host.webPort ?? host.port + 1}`,
  };
}

export function parseGameStreamXml(xml) {
  const parsed = parser.parse(xml);
  const root = parsed?.root;
  if (!root || typeof root !== "object") {
    throw new Error("The host returned an invalid GameStream XML response.");
  }
  const statusCode = Number(root.status_code ?? 200);
  if (statusCode !== 200) {
    throw new Error(root.status_message || `GameStream request failed with status ${statusCode}.`);
  }
  return root;
}

export function readText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "#text" in value) return String(value["#text"] ?? "");
  return "";
}

export async function getServerInfo(host, timeoutMs = 5_000) {
  const { http } = hostUrls(host);
  const response = await fetch(`${http}/serverinfo`, { signal: AbortSignal.timeout(timeoutMs) });
  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`Host status request failed with HTTP ${response.status}.`);
  }
  const root = parseGameStreamXml(xml);
  return {
    hostname: readText(root.hostname),
    appVersion: readText(root.appversion),
    gfeVersion: readText(root.GfeVersion),
    hostUuid: readText(root.uniqueid),
    httpsPort: Number(readText(root.HttpsPort)) || host.port - 5,
    externalPort: Number(readText(root.ExternalPort)) || host.port,
    codecModeSupport: Number(readText(root.ServerCodecModeSupport)) || 0,
    pairStatus: readText(root.PairStatus) === "1",
    currentGame: Number(readText(root.currentgame)) || 0,
    state: readText(root.state),
  };
}

export function gameStreamQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) query.set(key, String(value));
  }
  return query.toString();
}
