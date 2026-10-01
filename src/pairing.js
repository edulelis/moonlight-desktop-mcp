import { createCipheriv, createDecipheriv, createHash, randomBytes, sign, verify, X509Certificate } from "node:crypto";
import https from "node:https";
import forge from "node-forge";

import { gameStreamQuery, getServerInfo, hostUrls, parseGameStreamXml, readText } from "./host.js";

const PAIR_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;

function makeIdentity(deviceName) {
  const keyPair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keyPair.publicKey;
  certificate.serialNumber = randomBytes(8).toString("hex");
  certificate.validity.notBefore = new Date(Date.now() - 60_000);
  certificate.validity.notAfter = new Date(Date.now() + 20 * 365 * 24 * 60 * 60 * 1000);
  const attributes = [{ name: "commonName", value: deviceName }];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.sign(keyPair.privateKey, forge.md.sha256.create());

  return {
    clientId: randomBytes(8).toString("hex"),
    certificate: forge.pki.certificateToPem(certificate),
    privateKey: forge.pki.privateKeyToPem(keyPair.privateKey),
  };
}

function certificateSignature(certificatePem) {
  const certificate = forge.pki.certificateFromPem(certificatePem);
  return Buffer.from(certificate.signature, "binary");
}

function hash(algorithm, ...parts) {
  const digest = createHash(algorithm);
  for (const part of parts) digest.update(part);
  return digest.digest();
}

function aesEncrypt(plaintext, key) {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function aesDecrypt(ciphertext, key) {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function responseStatus(root) {
  if (readText(root.paired) !== "1") {
    throw new Error(readText(root.status_message) || "Apollo rejected the pairing request.");
  }
}

async function gameStreamHttp(host, command, params, timeoutMs, signal) {
  const { http } = hostUrls(host);
  const url = new URL(`${http}/${command}`);
  url.search = gameStreamQuery(params);
  const abort = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  const response = await fetch(url, { signal: abort });
  const xml = await response.text();
  if (!response.ok) throw new Error(`${command} failed with HTTP ${response.status}.`);
  return parseGameStreamXml(xml);
}

function gameStreamHttps(host, command, params, identity, serverCertificate, timeoutMs = REQUEST_TIMEOUT_MS) {
  const { https: baseUrl } = hostUrls(host);
  const url = new URL(`${baseUrl}/${command}`);
  url.search = gameStreamQuery(params);

  return new Promise((resolve, reject) => {
    const request = https.request({
      host: url.hostname,
      port: Number(url.port),
      method: "GET",
      path: `${url.pathname}${url.search}`,
      cert: identity.certificate,
      key: identity.privateKey,
      ca: serverCertificate,
      // `ca` pins the self-signed server certificate. The host can be an IP address,
      // so normal DNS-name validation is deliberately not applicable here.
      checkServerIdentity: () => undefined,
      rejectUnauthorized: true,
      // Apollo's SimpleWeb HTTPS server can reject a resumed TLS session after
      // an authenticated serverinfo request. A fresh one-shot TLS connection
      // mirrors Moonlight's request behavior and avoids sharing session state
      // between sensitive GameStream control requests.
      agent: false,
      timeout: timeoutMs,
      headers: { Connection: "close" },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          if ((response.statusCode ?? 500) >= 400) {
            throw new Error(`${command} failed with HTTP ${response.statusCode}.`);
          }
          resolve(parseGameStreamXml(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`${command} timed out.`)));
    request.on("error", reject);
    request.end();
  });
}

function clientRequestParams(identity, deviceName) {
  return { uniqueid: identity.clientId, devicename: deviceName, updateState: 1 };
}

export class PairingManager {
  constructor(store) {
    this.store = store;
    this.pending = new Map();
  }

  async begin(host, requestedName = "Moonlight MCP") {
    const info = await getServerInfo(host);
    if (!info.appVersion) throw new Error("The host did not identify itself as a GameStream server.");

    const deviceName = requestedName.trim().slice(0, 64) || "Moonlight MCP";
    const identity = makeIdentity(deviceName);
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    const id = randomBytes(12).toString("hex");
    const controller = new AbortController();
    const operation = {
      id,
      host: { ...host, httpsPort: info.httpsPort },
      deviceName,
      identity,
      pin,
      state: "waiting_for_apollo_approval",
      createdAt: new Date().toISOString(),
      error: null,
      controller,
    };
    this.pending.set(id, operation);
    operation.promise = this.finish(operation, info).catch((error) => {
      operation.state = controller.signal.aborted ? "cancelled" : "failed";
      operation.error = error.message;
    });

    const { web } = hostUrls(operation.host);
    return {
      pairingId: id,
      pin,
      apolloWebUrl: web,
      hostName: info.hostname || host.address,
      state: operation.state,
      instruction: `Open ${web} and enter PIN ${pin} to approve ${deviceName}. Then call pairing_status.`,
    };
  }

  async finish(operation, serverInfo) {
    const { host, identity, pin, deviceName, controller } = operation;
    const serverMajor = Number(serverInfo.appVersion.split(".")[0]);
    const algorithm = serverMajor >= 7 ? "sha256" : "sha1";
    const hashLength = algorithm === "sha256" ? 32 : 20;
    const salt = randomBytes(16);
    const aesKey = hash(algorithm, salt, Buffer.from(pin, "utf8")).subarray(0, 16);

    // Apollo deliberately keeps this HTTP request open until someone approves the PIN.
    const certificateRoot = await gameStreamHttp(host, "pair", {
      ...clientRequestParams(identity, deviceName),
      phrase: "getservercert",
      salt: salt.toString("hex"),
      clientcert: Buffer.from(identity.certificate, "utf8").toString("hex"),
    }, PAIR_TIMEOUT_MS, controller.signal);
    responseStatus(certificateRoot);

    const serverCertificate = Buffer.from(readText(certificateRoot.plaincert), "hex").toString("utf8");
    if (!serverCertificate.includes("BEGIN CERTIFICATE")) {
      throw new Error("Apollo returned no usable server certificate; another pairing may already be in progress.");
    }
    operation.state = "verifying_pairing";

    const challenge = randomBytes(16);
    const challengeRoot = await gameStreamHttp(host, "pair", {
      ...clientRequestParams(identity, deviceName),
      clientchallenge: aesEncrypt(challenge, aesKey).toString("hex"),
    }, REQUEST_TIMEOUT_MS, controller.signal);
    responseStatus(challengeRoot);

    const challengeResponseData = aesDecrypt(Buffer.from(readText(challengeRoot.challengeresponse), "hex"), aesKey);
    if (challengeResponseData.length < hashLength + 16) throw new Error("Apollo returned an invalid challenge response.");
    const serverResponse = challengeResponseData.subarray(0, hashLength);
    const serverChallenge = challengeResponseData.subarray(hashLength, hashLength + 16);
    const clientSecret = randomBytes(16);
    const expectedHashInput = Buffer.concat([
      serverChallenge,
      certificateSignature(identity.certificate),
      clientSecret,
    ]);
    const challengeHash = hash(algorithm, expectedHashInput);
    const paddedChallengeHash = algorithm === "sha1"
      ? Buffer.concat([challengeHash, Buffer.alloc(12)])
      : challengeHash;

    const secretRoot = await gameStreamHttp(host, "pair", {
      ...clientRequestParams(identity, deviceName),
      serverchallengeresp: aesEncrypt(paddedChallengeHash, aesKey).toString("hex"),
    }, REQUEST_TIMEOUT_MS, controller.signal);
    responseStatus(secretRoot);

    const pairingSecret = Buffer.from(readText(secretRoot.pairingsecret), "hex");
    if (pairingSecret.length <= 16) throw new Error("Apollo returned an invalid pairing secret.");
    const serverSecret = pairingSecret.subarray(0, 16);
    const serverSignature = pairingSecret.subarray(16);
    const serverPublicKey = new X509Certificate(serverCertificate).publicKey;
    if (!verify("sha256", serverSecret, serverPublicKey, serverSignature)) {
      throw new Error("Apollo's server signature did not validate.");
    }

    const expectedServerResponse = hash(
      algorithm,
      challenge,
      certificateSignature(serverCertificate),
      serverSecret,
    );
    if (!expectedServerResponse.equals(serverResponse)) {
      throw new Error("Apollo rejected the PIN or the pairing response could not be verified.");
    }

    const clientSignature = sign("sha256", clientSecret, identity.privateKey);
    const finalRoot = await gameStreamHttp(host, "pair", {
      ...clientRequestParams(identity, deviceName),
      clientpairingsecret: Buffer.concat([clientSecret, clientSignature]).toString("hex"),
    }, REQUEST_TIMEOUT_MS, controller.signal);
    responseStatus(finalRoot);

    const tlsRoot = await gameStreamHttps(host, "pair", {
      ...clientRequestParams(identity, deviceName),
      phrase: "pairchallenge",
    }, identity, serverCertificate);
    responseStatus(tlsRoot);

    const profile = {
      id: `apollo-${host.address.replaceAll(":", "_")}-${identity.clientId}`,
      deviceName,
      clientId: identity.clientId,
      host,
      serverCertificate,
      clientCertificate: identity.certificate,
      privateKey: identity.privateKey,
      createdAt: new Date().toISOString(),
    };
    await this.store.save(profile);
    operation.profileId = profile.id;
    operation.state = "paired";
    operation.pin = undefined;
  }

  status(pairingId) {
    const operation = this.pending.get(pairingId);
    if (!operation) throw new Error(`No active pairing named '${pairingId}'.`);
    const { web } = hostUrls(operation.host);
    return {
      pairingId,
      state: operation.state,
      apolloWebUrl: web,
      profileId: operation.profileId,
      error: operation.error,
      instruction: operation.state === "waiting_for_apollo_approval"
        ? "Enter the PIN returned by pairing_begin in Apollo, then call pairing_status again."
        : undefined,
    };
  }

  async cancel(pairingId) {
    const operation = this.pending.get(pairingId);
    if (!operation) throw new Error(`No active pairing named '${pairingId}'.`);
    operation.controller.abort();
    await operation.promise;
    return { pairingId, state: operation.state };
  }
}

export async function listApps(profile) {
  const root = await gameStreamHttps(profile.host, "applist", {
    uniqueid: profile.clientId,
    uuid: randomBytes(16).toString("hex"),
  }, {
    certificate: profile.clientCertificate,
    privateKey: profile.privateKey,
  }, profile.serverCertificate);

  const rawApps = root.App === undefined ? [] : (Array.isArray(root.App) ? root.App : [root.App]);
  return rawApps.map((app) => ({
    id: Number(readText(app.ID)) || 0,
    name: readText(app.AppTitle),
    hdrSupported: readText(app.IsHdrSupported) === "1",
  }));
}

function pairedIdentity(profile) {
  return {
    certificate: profile.clientCertificate,
    privateKey: profile.privateKey,
  };
}

// The HTTPS launch/cancel requests are the GameStream control plane. The
// resulting RTSP URL and one-time remote-input key are consumed only by the
// local native Moonlight bridge; neither is persisted or returned by an MCP
// tool result.
export async function launchApp(profile, { appId, width, height, fps, inputKey, inputIv }) {
  const remoteInputKeyId = inputIv.readInt32BE(0);
  const root = await gameStreamHttps(profile.host, "launch", {
    uniqueid: profile.clientId,
    appid: appId,
    mode: `${width}x${height}x${fps}`,
    additionalStates: 1,
    sops: 1,
    rikey: inputKey.toString("hex"),
    rikeyid: remoteInputKeyId,
    localAudioPlayMode: 0,
    surroundAudioInfo: 0x00030002,
    remoteControllersBitmap: 0,
    gcmap: 0,
    gcpersist: 1,
    corever: 1,
  }, pairedIdentity(profile), profile.serverCertificate, 60_000);

  return { rtspSessionUrl: readText(root.sessionUrl0) };
}

export async function cancelApp(profile) {
  let lastError;
  // Apollo can close its HTTPS socket immediately after accepting a cancel
  // request. Retrying only this idempotent operation makes cleanup reliable
  // without risking a second app launch.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await gameStreamHttps(profile.host, "cancel", {
        uniqueid: profile.clientId,
      }, pairedIdentity(profile), profile.serverCertificate, 30_000);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function getAuthenticatedHostStatus(profile) {
  const root = await gameStreamHttps(profile.host, "serverinfo", {
    uniqueid: profile.clientId,
    uuid: randomBytes(16).toString("hex"),
  }, pairedIdentity(profile), profile.serverCertificate);

  return {
    hostname: readText(root.hostname),
    permission: Number(readText(root.Permission)) || 0,
    pairStatus: readText(root.PairStatus) === "1",
    state: readText(root.state),
    currentGame: Number(readText(root.currentgame)) || 0,
  };
}
