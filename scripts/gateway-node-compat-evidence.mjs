#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { isDirectRunUrl } from "./lib/direct-run.mjs";

export const GATEWAY_NODE_COMPAT_SCHEMA = "openclaw.gateway-node-compat/v1";

const MAX_INPUT_BYTES = 64 * 1024;
const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]*$/u;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/u;

const NODE_KINDS = new Set(["android", "ios", "linux", "macos", "watchos", "wearos", "windows"]);
const ARCHITECTURES = new Set(["arm64", "x64"]);
const CONNECTION_MODES = new Set(["direct", "phone-proxy"]);
const PROTOCOL_CLIENT_IDS = new Set([
  "node-host",
  "openclaw-android",
  "openclaw-ios",
  "openclaw-macos",
  "openclaw-watchos",
]);
const OUTCOMES = new Set(["expected-protocol-mismatch", "passed"]);
const DIRECT_TOPOLOGIES = new Map([
  ["android", "openclaw-android"],
  ["ios", "openclaw-ios"],
  ["linux", "node-host"],
  ["macos", "openclaw-macos"],
  ["watchos", "openclaw-watchos"],
  ["windows", "node-host"],
]);

function hasControlCharacter(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertExactKeys(value, label, requiredKeys, optionalKeys = []) {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label}.${key} is not allowed`);
    }
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`${label}.${key} is required`);
    }
  }
}

function requireString(value, label, maxLength) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    throw new Error(`${label} must be a bounded non-control string`);
  }
  return value;
}

function requireEnum(value, label, allowedValues) {
  const normalized = requireString(value, label, 64);
  if (!allowedValues.has(normalized)) {
    throw new Error(`${label} is unsupported`);
  }
  return normalized;
}

function requirePattern(value, label, pattern, maxLength) {
  const normalized = requireString(value, label, maxLength);
  if (!pattern.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function requireArtifactName(value, label) {
  const artifactName = requireString(value, label, 255);
  if (
    artifactName === "." ||
    artifactName === ".." ||
    artifactName.includes("/") ||
    artifactName.includes("\\")
  ) {
    throw new Error(`${label} must be a basename`);
  }
  return artifactName;
}

function requirePathSegment(value, label, maxLength = 100) {
  const segment = requireString(value, label, maxLength);
  if (
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    !PATH_SEGMENT_PATTERN.test(segment)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return segment;
}

function requireRepository(value) {
  const repository = requireString(value, "producer.repository", 201);
  const segments = repository.split("/");
  if (segments.length !== 2) {
    throw new Error("producer.repository is invalid");
  }
  requirePathSegment(segments[0], "producer.repository owner");
  requirePathSegment(segments[1], "producer.repository name");
  return repository;
}

function requireWorkflowPath(value) {
  const workflowPath = requireString(value, "producer.workflowPath", 255);
  if (workflowPath.includes("\\")) {
    throw new Error("producer.workflowPath is invalid");
  }
  const segments = workflowPath.split("/");
  if (
    segments.length < 3 ||
    segments[0] !== ".github" ||
    segments[1] !== "workflows" ||
    !/\.ya?ml$/u.test(segments.at(-1) ?? "")
  ) {
    throw new Error("producer.workflowPath is invalid");
  }
  for (let index = 2; index < segments.length; index += 1) {
    requirePathSegment(segments[index], `producer.workflowPath segment ${index - 1}`, 128);
  }
  return workflowPath;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function requireCanonicalTimestamp(value, label) {
  const timestamp = requireString(value, label, 32);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== timestamp) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

function assertInputSize(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("gateway-node compatibility evidence must be JSON serializable");
  }
  if (serialized === undefined) {
    throw new Error("gateway-node compatibility evidence must be JSON serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_INPUT_BYTES) {
    throw new Error(`gateway-node compatibility evidence exceeds ${MAX_INPUT_BYTES} bytes`);
  }
}

function validateArtifact(value, label) {
  const artifact = requireObject(value, label);
  assertExactKeys(artifact, label, ["version", "sourceSha", "artifactName", "artifactSha256"]);
  requireString(artifact.version, `${label}.version`, 128);
  requirePattern(artifact.sourceSha, `${label}.sourceSha`, SOURCE_SHA_PATTERN, 40);
  requireArtifactName(artifact.artifactName, `${label}.artifactName`);
  requirePattern(artifact.artifactSha256, `${label}.artifactSha256`, SHA256_PATTERN, 64);
}

function validateProxy(value) {
  const proxy = requireObject(value, "node.proxy");
  assertExactKeys(proxy, "node.proxy", [
    "version",
    "sourceSha",
    "artifactName",
    "artifactSha256",
    "kind",
    "architecture",
    "protocolClientId",
  ]);
  validateArtifact(
    {
      version: proxy.version,
      sourceSha: proxy.sourceSha,
      artifactName: proxy.artifactName,
      artifactSha256: proxy.artifactSha256,
    },
    "node.proxy",
  );
  if (proxy.kind !== "android") {
    throw new Error("node.proxy.kind must be android");
  }
  requireEnum(proxy.architecture, "node.proxy.architecture", ARCHITECTURES);
  if (proxy.protocolClientId !== "openclaw-android") {
    throw new Error("node.proxy.protocolClientId must be openclaw-android");
  }
}

function validateNode(value) {
  const node = requireObject(value, "node");
  assertExactKeys(
    node,
    "node",
    [
      "version",
      "sourceSha",
      "artifactName",
      "artifactSha256",
      "kind",
      "architecture",
      "connectionMode",
      "protocolClientId",
    ],
    ["proxy"],
  );
  validateArtifact(
    {
      version: node.version,
      sourceSha: node.sourceSha,
      artifactName: node.artifactName,
      artifactSha256: node.artifactSha256,
    },
    "node",
  );
  const kind = requireEnum(node.kind, "node.kind", NODE_KINDS);
  requireEnum(node.architecture, "node.architecture", ARCHITECTURES);
  const connectionMode = requireEnum(node.connectionMode, "node.connectionMode", CONNECTION_MODES);
  const protocolClientId = requireEnum(
    node.protocolClientId,
    "node.protocolClientId",
    PROTOCOL_CLIENT_IDS,
  );

  if (kind === "wearos") {
    if (connectionMode !== "phone-proxy" || protocolClientId !== "openclaw-android") {
      throw new Error(
        "wearos nodes require phone-proxy topology with protocol client openclaw-android",
      );
    }
    if (!Object.hasOwn(node, "proxy")) {
      throw new Error("wearos phone-proxy topology requires node.proxy");
    }
    validateProxy(node.proxy);
    return;
  }

  const expectedClientId = DIRECT_TOPOLOGIES.get(kind);
  if (connectionMode !== "direct" || protocolClientId !== expectedClientId) {
    throw new Error(
      `${kind} nodes require direct topology with protocol client ${expectedClientId}`,
    );
  }
  if (Object.hasOwn(node, "proxy")) {
    throw new Error("direct node topology must not include node.proxy");
  }
}

function validateProtocol(value) {
  const protocol = requireObject(value, "protocol");
  assertExactKeys(protocol, "protocol", [
    "gatewayCurrent",
    "gatewayNodeMinimum",
    "protocolClientAdvertisedMin",
    "protocolClientAdvertisedMax",
    "helloProtocol",
  ]);
  const gatewayCurrent = requirePositiveInteger(protocol.gatewayCurrent, "protocol.gatewayCurrent");
  const gatewayNodeMinimum = requirePositiveInteger(
    protocol.gatewayNodeMinimum,
    "protocol.gatewayNodeMinimum",
  );
  const protocolClientAdvertisedMin = requirePositiveInteger(
    protocol.protocolClientAdvertisedMin,
    "protocol.protocolClientAdvertisedMin",
  );
  const protocolClientAdvertisedMax = requirePositiveInteger(
    protocol.protocolClientAdvertisedMax,
    "protocol.protocolClientAdvertisedMax",
  );
  if (gatewayNodeMinimum > gatewayCurrent) {
    throw new Error("protocol.gatewayNodeMinimum must not exceed protocol.gatewayCurrent");
  }
  if (protocolClientAdvertisedMin > protocolClientAdvertisedMax) {
    throw new Error(
      "protocol.protocolClientAdvertisedMin must not exceed protocol.protocolClientAdvertisedMax",
    );
  }
  if (protocol.helloProtocol !== null) {
    requirePositiveInteger(protocol.helloProtocol, "protocol.helloProtocol");
  }
  return {
    gatewayCurrent,
    gatewayNodeMinimum,
    protocolClientAdvertisedMax,
    protocolClientAdvertisedMin,
  };
}

function validateResult(value) {
  const result = requireObject(value, "result");
  assertExactKeys(
    result,
    "result",
    ["outcome", "startedAt", "completedAt"],
    ["failureCode", "failurePhase"],
  );
  const outcome = requireEnum(result.outcome, "result.outcome", OUTCOMES);
  const startedAt = requireCanonicalTimestamp(result.startedAt, "result.startedAt");
  const completedAt = requireCanonicalTimestamp(result.completedAt, "result.completedAt");
  if (completedAt < startedAt) {
    throw new Error("result.completedAt must not precede result.startedAt");
  }
  if (result.failureCode !== undefined) {
    requireString(result.failureCode, "result.failureCode", 64);
  }
  if (result.failurePhase !== undefined) {
    requireString(result.failurePhase, "result.failurePhase", 64);
  }
  return outcome;
}

function validateProducer(value) {
  const producer = requireObject(value, "producer");
  assertExactKeys(producer, "producer", [
    "repository",
    "workflowPath",
    "workflowSha",
    "runId",
    "runAttempt",
    "job",
  ]);
  requireRepository(producer.repository);
  requireWorkflowPath(producer.workflowPath);
  requirePattern(producer.workflowSha, "producer.workflowSha", SOURCE_SHA_PATTERN, 40);
  requirePattern(producer.runId, "producer.runId", POSITIVE_DECIMAL_PATTERN, 32);
  requirePositiveInteger(producer.runAttempt, "producer.runAttempt");
  requireString(producer.job, "producer.job", 128);
}

function validateOutcomeCoupling(evidence, protocol, outcome) {
  const rangesOverlap =
    protocol.protocolClientAdvertisedMin <= protocol.gatewayCurrent &&
    protocol.protocolClientAdvertisedMax >= protocol.gatewayNodeMinimum;
  if (outcome === "passed") {
    if (!rangesOverlap) {
      throw new Error("passed evidence requires overlapping gateway and node protocol ranges");
    }
    if (evidence.protocol.helloProtocol !== protocol.gatewayCurrent) {
      throw new Error("passed evidence requires helloProtocol to equal gatewayCurrent");
    }
    if (evidence.result.failureCode !== undefined || evidence.result.failurePhase !== undefined) {
      throw new Error("passed evidence must not include failure fields");
    }
    return;
  }

  if (rangesOverlap) {
    throw new Error("expected-protocol-mismatch evidence requires disjoint protocol ranges");
  }
  if (evidence.protocol.helloProtocol !== null) {
    throw new Error("expected-protocol-mismatch evidence requires helloProtocol to be null");
  }
  if (evidence.result.failureCode !== "PROTOCOL_MISMATCH") {
    throw new Error("expected-protocol-mismatch evidence requires failureCode PROTOCOL_MISMATCH");
  }
  if (evidence.result.failurePhase !== "connect") {
    throw new Error("expected-protocol-mismatch evidence requires failurePhase connect");
  }
}

/**
 * Validates one immutable Gateway/node compatibility matrix result.
 *
 * The Gateway hello protocol and the node's compatibility range are separate:
 * a legacy v3 node can receive a v4 hello while remaining constrained to v3.
 */
export function validateGatewayNodeCompatEvidence(value) {
  assertInputSize(value);
  const evidence = requireObject(value, "gateway-node compatibility evidence");
  assertExactKeys(evidence, "gateway-node compatibility evidence", [
    "schema",
    "gateway",
    "node",
    "protocol",
    "result",
    "producer",
  ]);
  if (evidence.schema !== GATEWAY_NODE_COMPAT_SCHEMA) {
    throw new Error("gateway-node compatibility evidence schema is unsupported");
  }
  validateArtifact(evidence.gateway, "gateway");
  validateNode(evidence.node);
  const protocol = validateProtocol(evidence.protocol);
  const outcome = validateResult(evidence.result);
  validateProducer(evidence.producer);
  validateOutcomeCoupling(evidence, protocol, outcome);
  return evidence;
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

export function canonicalizeGatewayNodeCompatEvidence(value) {
  const evidence = validateGatewayNodeCompatEvidence(value);
  return `${JSON.stringify(sortJson(evidence), null, 2)}\n`;
}

function readEvidenceFile(filePath) {
  const descriptor = openSync(filePath, "r");
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new Error("gateway-node compatibility evidence input must be a regular file");
    }
    if (stat.size > MAX_INPUT_BYTES) {
      throw new Error(`gateway-node compatibility evidence exceeds ${MAX_INPUT_BYTES} bytes`);
    }
    const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let totalBytes = 0;
    while (totalBytes < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, totalBytes, buffer.length - totalBytes, null);
      if (bytesRead === 0) {
        break;
      }
      totalBytes += bytesRead;
    }
    if (totalBytes > MAX_INPUT_BYTES) {
      throw new Error(`gateway-node compatibility evidence exceeds ${MAX_INPUT_BYTES} bytes`);
    }
    return JSON.parse(buffer.subarray(0, totalBytes).toString("utf8"));
  } finally {
    closeSync(descriptor);
  }
}

function writeEvidenceFileAtomically(filePath, content) {
  const directory = path.dirname(path.resolve(filePath));
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${randomUUID()}`,
  );
  let descriptor;
  try {
    descriptor = openSync(tempPath, "wx", 0o600);
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(tempPath, filePath);
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    rmSync(tempPath, { force: true });
  }
}

function parseCanonicalizeArgs(args) {
  let input;
  let output;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input" && input === undefined) {
      input = args[++index];
    } else if (argument === "--output" && output === undefined) {
      output = args[++index];
    } else {
      throw new Error(`unknown or incomplete argument: ${argument}`);
    }
  }
  if (!input || !output) {
    throw new Error("canonicalize requires --input <file> --output <file>");
  }
  return { input, output };
}

async function main(args) {
  const [command, ...commandArgs] = args;
  if (command === "validate" && commandArgs.length === 1) {
    validateGatewayNodeCompatEvidence(readEvidenceFile(commandArgs[0]));
    console.log("valid");
    return;
  }
  if (command === "canonicalize") {
    const { input, output } = parseCanonicalizeArgs(commandArgs);
    const evidence = readEvidenceFile(input);
    const canonical = canonicalizeGatewayNodeCompatEvidence(evidence);
    writeEvidenceFileAtomically(output, canonical);
    return;
  }
  throw new Error(
    "usage: gateway-node-compat-evidence.mjs validate <file> | canonicalize --input <file> --output <file>",
  );
}

function formatCliError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t\u2028\u2029]+/gu, " ").slice(0, 512);
}

if (isDirectRunUrl(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2)).catch((error) => {
    console.error(formatCliError(error));
    process.exitCode = 1;
  });
}
