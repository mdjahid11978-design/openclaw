import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as evidenceModule from "../../scripts/gateway-node-compat-evidence.mjs";
import {
  GATEWAY_NODE_COMPAT_SCHEMA,
  canonicalizeGatewayNodeCompatEvidence,
  validateGatewayNodeCompatEvidence,
} from "../../scripts/gateway-node-compat-evidence.mjs";

const SCRIPT_PATH = "scripts/gateway-node-compat-evidence.mjs";
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "openclaw-gateway-node-compat-"));
  tempRoots.push(root);
  return root;
}

function validPassEvidence(): Record<string, any> {
  return {
    schema: GATEWAY_NODE_COMPAT_SCHEMA,
    gateway: {
      version: "v2026.8.6",
      sourceSha: "a".repeat(40),
      artifactName: "openclaw-gateway.tgz",
      artifactSha256: "b".repeat(64),
    },
    node: {
      version: "v2026.5.27",
      sourceSha: "c".repeat(40),
      artifactName: "openclaw-ios.ipa",
      artifactSha256: "d".repeat(64),
      kind: "ios",
      architecture: "arm64",
      connectionMode: "direct",
      protocolClientId: "openclaw-ios",
    },
    protocol: {
      gatewayCurrent: 4,
      gatewayNodeMinimum: 3,
      protocolClientAdvertisedMin: 3,
      protocolClientAdvertisedMax: 3,
      helloProtocol: 4,
    },
    result: {
      outcome: "passed",
      startedAt: "2026-08-06T12:00:00.000Z",
      completedAt: "2026-08-06T12:00:05.000Z",
    },
    producer: {
      repository: "openclaw/openclaw",
      workflowPath: ".github/workflows/gateway-node-compat.yml",
      workflowSha: "e".repeat(40),
      runId: "123456789",
      runAttempt: 2,
      job: "ios-v3-node",
    },
  };
}

function validMismatchEvidence(): Record<string, any> {
  const evidence = validPassEvidence();
  evidence.node.kind = "wearos";
  evidence.node.architecture = "arm64";
  evidence.node.connectionMode = "phone-proxy";
  evidence.node.protocolClientId = "openclaw-android";
  evidence.node.proxy = {
    version: "v2026.8.6",
    sourceSha: "f".repeat(40),
    artifactName: "openclaw-android.apk",
    artifactSha256: "1".repeat(64),
    kind: "android",
    architecture: "arm64",
    protocolClientId: "openclaw-android",
  };
  evidence.protocol.protocolClientAdvertisedMin = 5;
  evidence.protocol.protocolClientAdvertisedMax = 5;
  evidence.protocol.helloProtocol = null;
  evidence.result = {
    outcome: "expected-protocol-mismatch",
    failureCode: "PROTOCOL_MISMATCH",
    failurePhase: "connect",
    startedAt: "2026-08-06T12:00:00.000Z",
    completedAt: "2026-08-06T12:00:01.000Z",
  };
  return evidence;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("gateway node compatibility evidence", () => {
  it("accepts a legacy node whose range overlaps the Gateway minimum", () => {
    const evidence = validPassEvidence();

    expect(validateGatewayNodeCompatEvidence(evidence)).toBe(evidence);
  });

  it("accepts an expected protocol mismatch with phone-proxied Wear attribution", () => {
    const evidence = validMismatchEvidence();

    expect(validateGatewayNodeCompatEvidence(evidence)).toBe(evidence);
  });

  it.each([
    ["root", (value: Record<string, any>) => (value.extra = true)],
    ["gateway", (value: Record<string, any>) => (value.gateway.extra = true)],
    ["node", (value: Record<string, any>) => (value.node.extra = true)],
    ["protocol", (value: Record<string, any>) => (value.protocol.extra = true)],
    ["result", (value: Record<string, any>) => (value.result.extra = true)],
    ["producer", (value: Record<string, any>) => (value.producer.extra = true)],
  ])("rejects unknown keys at the %s level", (_label, mutate) => {
    const evidence = validPassEvidence();
    mutate(evidence);

    expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(/not allowed/u);
  });

  it("rejects unknown proxy keys", () => {
    const evidence = validMismatchEvidence();
    evidence.node.proxy.extra = true;

    expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(
      /node\.proxy\.extra is not allowed/u,
    );
  });

  it.each([
    ["gateway", (value: Record<string, any>) => delete value.gateway.version],
    ["node", (value: Record<string, any>) => delete value.node.kind],
    ["protocol", (value: Record<string, any>) => delete value.protocol.helloProtocol],
    ["result", (value: Record<string, any>) => delete value.result.completedAt],
    ["producer", (value: Record<string, any>) => delete value.producer.job],
  ])("rejects missing keys at the %s level", (_label, mutate) => {
    const evidence = validPassEvidence();
    mutate(evidence);

    expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(/is required/u);
  });

  it("rejects bounded strings and control characters", () => {
    const oversized = validPassEvidence();
    oversized.gateway.version = "v".repeat(129);
    expect(() => validateGatewayNodeCompatEvidence(oversized)).toThrow(
      /bounded non-control string/u,
    );

    const controlled = validPassEvidence();
    controlled.producer.job = "ios\u0000node";
    expect(() => validateGatewayNodeCompatEvidence(controlled)).toThrow(
      /bounded non-control string/u,
    );
  });

  it.each(["../gateway.tgz", "artifacts/gateway.tgz", "artifacts\\gateway.tgz", ".", ".."])(
    "rejects non-basename artifact name %s",
    (artifactName) => {
      const evidence = validPassEvidence();
      evidence.gateway.artifactName = artifactName;

      expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(/must be a basename/u);
    },
  );

  it("requires lowercase full source SHAs and SHA-256 digests", () => {
    for (const sourceSha of ["a".repeat(39), "A".repeat(40), "g".repeat(40)]) {
      const evidence = validPassEvidence();
      evidence.gateway.sourceSha = sourceSha;
      expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(
        /gateway.sourceSha is invalid/u,
      );
    }

    for (const digest of ["b".repeat(63), "B".repeat(64), "z".repeat(64)]) {
      const evidence = validPassEvidence();
      evidence.node.artifactSha256 = digest;
      expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(
        /node.artifactSha256 is invalid/u,
      );
    }
  });

  it("requires canonical ordered timestamps", () => {
    const nonCanonical = validPassEvidence();
    nonCanonical.result.startedAt = "2026-08-06T12:00:00Z";
    expect(() => validateGatewayNodeCompatEvidence(nonCanonical)).toThrow(
      /canonical ISO timestamp/u,
    );

    const reversed = validPassEvidence();
    reversed.result.completedAt = "2026-08-06T11:59:59.000Z";
    expect(() => validateGatewayNodeCompatEvidence(reversed)).toThrow(/must not precede/u);
  });

  it("requires positive ordered protocol bounds", () => {
    const zero = validPassEvidence();
    zero.protocol.gatewayCurrent = 0;
    expect(() => validateGatewayNodeCompatEvidence(zero)).toThrow(/positive integer/u);

    const gatewayRange = validPassEvidence();
    gatewayRange.protocol.gatewayNodeMinimum = 5;
    expect(() => validateGatewayNodeCompatEvidence(gatewayRange)).toThrow(
      /must not exceed protocol.gatewayCurrent/u,
    );

    const nodeRange = validPassEvidence();
    nodeRange.protocol.protocolClientAdvertisedMin = 4;
    nodeRange.protocol.protocolClientAdvertisedMax = 3;
    expect(() => validateGatewayNodeCompatEvidence(nodeRange)).toThrow(
      /must not exceed protocol.protocolClientAdvertisedMax/u,
    );
  });

  it("couples passed outcomes to overlap, current hello, and no failure", () => {
    const disjoint = validPassEvidence();
    disjoint.protocol.protocolClientAdvertisedMin = 5;
    disjoint.protocol.protocolClientAdvertisedMax = 5;
    expect(() => validateGatewayNodeCompatEvidence(disjoint)).toThrow(/overlapping/u);

    const staleHello = validPassEvidence();
    staleHello.protocol.helloProtocol = 3;
    expect(() => validateGatewayNodeCompatEvidence(staleHello)).toThrow(
      /helloProtocol to equal gatewayCurrent/u,
    );

    const failed = validPassEvidence();
    failed.result.failureCode = "SOMETHING_FAILED";
    expect(() => validateGatewayNodeCompatEvidence(failed)).toThrow(
      /must not include failure fields/u,
    );
  });

  it("couples mismatch outcomes to disjoint ranges and exact failure evidence", () => {
    const overlapping = validMismatchEvidence();
    overlapping.protocol.protocolClientAdvertisedMin = 3;
    overlapping.protocol.protocolClientAdvertisedMax = 3;
    expect(() => validateGatewayNodeCompatEvidence(overlapping)).toThrow(/disjoint/u);

    const hello = validMismatchEvidence();
    hello.protocol.helloProtocol = 4;
    expect(() => validateGatewayNodeCompatEvidence(hello)).toThrow(/helloProtocol to be null/u);

    const code = validMismatchEvidence();
    code.result.failureCode = "AUTH_FAILED";
    expect(() => validateGatewayNodeCompatEvidence(code)).toThrow(/PROTOCOL_MISMATCH/u);

    const phase = validMismatchEvidence();
    delete phase.result.failurePhase;
    expect(() => validateGatewayNodeCompatEvidence(phase)).toThrow(/failurePhase connect/u);

    const localPhase = validMismatchEvidence();
    localPhase.result.failurePhase = "websocket-handshake";
    expect(() => validateGatewayNodeCompatEvidence(localPhase)).toThrow(/failurePhase connect/u);
  });

  it.each([
    ["node kind", "kind", "ipad"],
    ["architecture", "architecture", "armv7"],
    ["connection mode", "connectionMode", "relay"],
    ["protocol client id", "protocolClientId", "openclaw-wearos"],
  ])("rejects unsupported %s", (_label, key, value) => {
    const evidence = validPassEvidence();
    evidence.node[key] = value;

    expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(/is unsupported/u);
  });

  it.each([
    ["android", "openclaw-android"],
    ["ios", "openclaw-ios"],
    ["macos", "openclaw-macos"],
    ["watchos", "openclaw-watchos"],
    ["linux", "node-host"],
    ["windows", "node-host"],
  ])("accepts the %s direct topology", (kind, protocolClientId) => {
    const evidence = validPassEvidence();
    evidence.node.kind = kind;
    evidence.node.protocolClientId = protocolClientId;

    expect(validateGatewayNodeCompatEvidence(evidence)).toBe(evidence);
  });

  it("rejects invalid direct and phone-proxy topology tuples", () => {
    const wrongDirectClient = validPassEvidence();
    wrongDirectClient.node.kind = "windows";
    wrongDirectClient.node.protocolClientId = "openclaw-ios";
    expect(() => validateGatewayNodeCompatEvidence(wrongDirectClient)).toThrow(
      /windows nodes require direct topology with protocol client node-host/u,
    );

    const wearDirect = validPassEvidence();
    wearDirect.node.kind = "wearos";
    wearDirect.node.protocolClientId = "openclaw-android";
    expect(() => validateGatewayNodeCompatEvidence(wearDirect)).toThrow(
      /wearos nodes require phone-proxy topology/u,
    );

    const wearWithoutProxy = validMismatchEvidence();
    delete wearWithoutProxy.node.proxy;
    expect(() => validateGatewayNodeCompatEvidence(wearWithoutProxy)).toThrow(
      /requires node.proxy/u,
    );

    const directWithProxy = validPassEvidence();
    directWithProxy.node.proxy = clone(validMismatchEvidence().node.proxy);
    expect(() => validateGatewayNodeCompatEvidence(directWithProxy)).toThrow(
      /direct node topology must not include node.proxy/u,
    );
  });

  it("binds phone-proxy evidence to the Android protocol endpoint", () => {
    const wrongKind = validMismatchEvidence();
    wrongKind.node.proxy.kind = "ios";
    expect(() => validateGatewayNodeCompatEvidence(wrongKind)).toThrow(
      /node.proxy.kind must be android/u,
    );

    const wrongArchitecture = validMismatchEvidence();
    wrongArchitecture.node.proxy.architecture = "armv7";
    expect(() => validateGatewayNodeCompatEvidence(wrongArchitecture)).toThrow(
      /node.proxy.architecture is unsupported/u,
    );

    const wrongClient = validMismatchEvidence();
    wrongClient.node.proxy.protocolClientId = "openclaw-ios";
    expect(() => validateGatewayNodeCompatEvidence(wrongClient)).toThrow(
      /node.proxy.protocolClientId must be openclaw-android/u,
    );
  });

  it("rejects invalid producer identity fields", () => {
    for (const repositoryValue of [
      "openclaw",
      "openclaw/",
      "/openclaw",
      "openclaw/..",
      "./openclaw",
      "owner//repo",
      "owner/repo/extra",
      "owner\\repo",
    ]) {
      const repository = validPassEvidence();
      repository.producer.repository = repositoryValue;
      expect(() => validateGatewayNodeCompatEvidence(repository)).toThrow(/producer.repository/u);
    }

    for (const workflowPath of [
      "../workflow.yml",
      ".github/workflows//release.yml",
      ".github/workflows/./release.yml",
      ".github/workflows/../release.yml",
      ".github\\workflows\\release.yml",
      ".github/workflows/release.json",
    ]) {
      const workflow = validPassEvidence();
      workflow.producer.workflowPath = workflowPath;
      expect(() => validateGatewayNodeCompatEvidence(workflow)).toThrow(/producer.workflowPath/u);
    }

    const run = validPassEvidence();
    run.producer.runId = "01";
    expect(() => validateGatewayNodeCompatEvidence(run)).toThrow(/producer.runId is invalid/u);
  });

  it("canonicalizes to exact deterministic fixture bytes", () => {
    const evidence = validPassEvidence();
    const shuffled = {
      result: clone(evidence.result),
      protocol: clone(evidence.protocol),
      node: clone(evidence.node),
      schema: evidence.schema,
      producer: clone(evidence.producer),
      gateway: clone(evidence.gateway),
    };

    const canonical = canonicalizeGatewayNodeCompatEvidence(shuffled);
    const expected = `{
  "gateway": {
    "artifactName": "openclaw-gateway.tgz",
    "artifactSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "sourceSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "version": "v2026.8.6"
  },
  "node": {
    "architecture": "arm64",
    "artifactName": "openclaw-ios.ipa",
    "artifactSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "connectionMode": "direct",
    "kind": "ios",
    "protocolClientId": "openclaw-ios",
    "sourceSha": "cccccccccccccccccccccccccccccccccccccccc",
    "version": "v2026.5.27"
  },
  "producer": {
    "job": "ios-v3-node",
    "repository": "openclaw/openclaw",
    "runAttempt": 2,
    "runId": "123456789",
    "workflowPath": ".github/workflows/gateway-node-compat.yml",
    "workflowSha": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  },
  "protocol": {
    "gatewayCurrent": 4,
    "gatewayNodeMinimum": 3,
    "helloProtocol": 4,
    "protocolClientAdvertisedMax": 3,
    "protocolClientAdvertisedMin": 3
  },
  "result": {
    "completedAt": "2026-08-06T12:00:05.000Z",
    "outcome": "passed",
    "startedAt": "2026-08-06T12:00:00.000Z"
  },
  "schema": "openclaw.gateway-node-compat/v1"
}
`;

    expect(Buffer.from(canonical)).toEqual(Buffer.from(expected));
    expect(canonicalizeGatewayNodeCompatEvidence(JSON.parse(canonical))).toBe(canonical);
  });

  it("enforces the 64 KiB input limit", () => {
    const evidence = validPassEvidence();
    evidence.gateway.version = "x".repeat(65 * 1024);

    expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(/exceeds 65536 bytes/u);
  });

  it("validates and canonicalizes evidence through the CLI", () => {
    const root = makeTempRoot();
    const inputPath = path.join(root, "input.json");
    const outputPath = path.join(root, "output.json");
    writeFileSync(inputPath, JSON.stringify(validPassEvidence()), "utf8");

    const validateResult = runCli(["validate", inputPath]);
    expect(validateResult.status).toBe(0);
    expect(validateResult.stdout).toBe("valid\n");
    expect(validateResult.stderr).toBe("");

    const canonicalizeResult = runCli([
      "canonicalize",
      "--output",
      outputPath,
      "--input",
      inputPath,
    ]);
    expect(canonicalizeResult.status).toBe(0);
    expect(canonicalizeResult.stdout).toBe("");
    expect(canonicalizeResult.stderr).toBe("");
    expect(readFileSync(outputPath, "utf8")).toBe(
      canonicalizeGatewayNodeCompatEvidence(validPassEvidence()),
    );
  });

  it("atomically canonicalizes when input and output are the same file", () => {
    const root = makeTempRoot();
    const evidencePath = path.join(root, "evidence.json");
    writeFileSync(evidencePath, JSON.stringify(validPassEvidence()), "utf8");

    const result = runCli(["canonicalize", "--input", evidencePath, "--output", evidencePath]);

    expect(result.status).toBe(0);
    expect(readFileSync(evidencePath, "utf8")).toBe(
      canonicalizeGatewayNodeCompatEvidence(validPassEvidence()),
    );
    expect(readdirSync(root).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  it("preserves an existing destination when validation fails", () => {
    const root = makeTempRoot();
    const inputPath = path.join(root, "invalid.json");
    const outputPath = path.join(root, "evidence.json");
    const invalid = validPassEvidence();
    invalid.node.protocolClientId = "node-host";
    writeFileSync(inputPath, JSON.stringify(invalid), "utf8");
    writeFileSync(outputPath, "existing evidence\n", "utf8");

    const result = runCli(["canonicalize", "--input", inputPath, "--output", outputPath]);

    expect(result.status).not.toBe(0);
    expect(readFileSync(outputPath, "utf8")).toBe("existing evidence\n");
    expect(readdirSync(root).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  it("cleans the same-directory temp file when atomic replacement fails", () => {
    const root = makeTempRoot();
    const inputPath = path.join(root, "input.json");
    const outputPath = path.join(root, "destination");
    const markerPath = path.join(outputPath, "marker.txt");
    writeFileSync(inputPath, JSON.stringify(validPassEvidence()), "utf8");
    mkdirSync(outputPath);
    writeFileSync(markerPath, "keep\n", "utf8");

    const result = runCli(["canonicalize", "--input", inputPath, "--output", outputPath]);

    expect(result.status).not.toBe(0);
    expect(readFileSync(markerPath, "utf8")).toBe("keep\n");
    expect(readdirSync(root).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  it("requires CLI input to be a regular file", () => {
    const root = makeTempRoot();

    const result = runCli(["validate", root]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("input must be a regular file");
  });

  it("rejects oversized CLI input before parsing", () => {
    const root = makeTempRoot();
    const inputPath = path.join(root, "oversized.json");
    writeFileSync(inputPath, `${JSON.stringify(validPassEvidence())}${" ".repeat(65 * 1024)}`);

    const result = runCli(["validate", inputPath]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exceeds 65536 bytes");
  });

  it("prints one stack-free error line for CLI failures", () => {
    const root = makeTempRoot();
    const inputPath = path.join(root, "invalid.json");
    writeFileSync(inputPath, "{\nnot-json\n", "utf8");

    const result = runCli(["validate", inputPath]);
    const lines = result.stderr.trimEnd().split("\n");

    expect(result.status).not.toBe(0);
    expect(lines).toHaveLength(1);
    expect(result.stderr).not.toContain("\n    at ");
  });

  it("keeps declaration value exports aligned with runtime exports", () => {
    const declaration = readFileSync("scripts/gateway-node-compat-evidence.d.mts", "utf8");
    const declaredValueExports = Array.from(
      declaration.matchAll(/export (?:declare )?(?:const|function) ([A-Za-z0-9_]+)/gu),
      (match) => match[1],
    ).toSorted();

    expect(Object.keys(evidenceModule).toSorted()).toEqual(declaredValueExports);
  });
});
