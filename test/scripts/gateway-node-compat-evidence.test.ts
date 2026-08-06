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

function packagedArtifact(
  version: string,
  sourceSha: string,
  name: string,
  sha256: string,
  artifactSeed: string,
) {
  return {
    version,
    sourceSha,
    name,
    sha256,
    actionsArtifact: {
      id: Number.parseInt(artifactSeed.repeat(4), 10),
      name: `${name}-input`,
      digest: `sha256:${artifactSeed.repeat(64)}`,
      sizeBytes: 4096,
      runId: `${artifactSeed.repeat(9)}`,
      runAttempt: 2,
    },
  };
}

function installedRuntime(version: string, sourceSha: string, identitySha256: string) {
  return { version, sourceSha, identitySha256 };
}

function validPassEvidence(): Record<string, any> {
  const gatewayVersion = "v2026.8.6";
  const gatewaySourceSha = "a".repeat(40);
  const nodeVersion = "v2026.5.7";
  const nodeSourceSha = "c".repeat(40);
  return {
    schema: GATEWAY_NODE_COMPAT_SCHEMA,
    caseId: "linux-x64-candidate-gateway-baseline-node",
    direction: "candidate-gateway-baseline-node",
    connection: {
      transport: "gateway-websocket",
      role: "node",
      mode: "node",
    },
    gateway: {
      packagedArtifact: packagedArtifact(
        gatewayVersion,
        gatewaySourceSha,
        "openclaw-candidate.tgz",
        "b".repeat(64),
        "1",
      ),
      installedRuntime: installedRuntime(gatewayVersion, gatewaySourceSha, "2".repeat(64)),
    },
    node: {
      kind: "linux",
      architecture: "x64",
      protocolClientId: "node-host",
      packagedArtifact: packagedArtifact(
        nodeVersion,
        nodeSourceSha,
        "openclaw-baseline.tgz",
        "d".repeat(64),
        "3",
      ),
      installedRuntime: installedRuntime(nodeVersion, nodeSourceSha, "4".repeat(64)),
    },
    protocol: {
      gatewayProtocolVersion: 4,
      gatewayAcceptedNodeMin: 3,
      protocolClientAdvertisedMin: 3,
      protocolClientAdvertisedMax: 3,
      helloProtocol: 4,
    },
    operation: {
      method: "node.invoke",
      command: "system.which",
      params: {
        bins: ["node"],
      },
      ok: true,
      result: {
        bins: {
          node: "/usr/bin/node",
        },
      },
    },
    result: {
      outcome: "passed",
      startedAt: "2026-08-06T12:00:00.000Z",
      completedAt: "2026-08-06T12:00:05.000Z",
    },
    producer: {
      repository: "openclaw/openclaw",
      workflowPath: ".github/workflows/openclaw-cross-os-release-checks-reusable.yml",
      workflowSha: "e".repeat(40),
      runId: "123456789",
      runAttempt: 2,
      job: "gateway-node-compat-linux-x64",
    },
  };
}

function validMismatchEvidence(): Record<string, any> {
  const evidence = validPassEvidence();
  evidence.caseId = "linux-x64-candidate-gateway-disjoint-node";
  evidence.direction = "candidate-gateway-disjoint-node";
  evidence.protocol.protocolClientAdvertisedMin = 5;
  evidence.protocol.protocolClientAdvertisedMax = 5;
  evidence.protocol.helloProtocol = null;
  evidence.operation = null;
  evidence.result = {
    outcome: "protocol-mismatch",
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
  it("accepts observed direct WebSocket node invocation evidence", () => {
    const evidence = validPassEvidence();

    expect(validateGatewayNodeCompatEvidence(evidence)).toBe(evidence);
  });

  it("accepts observed structured protocol mismatch evidence", () => {
    const evidence = validMismatchEvidence();

    expect(validateGatewayNodeCompatEvidence(evidence)).toBe(evidence);
  });

  it.each([
    "baseline-gateway-baseline-node",
    "baseline-gateway-candidate-node",
    "candidate-gateway-baseline-node",
    "candidate-gateway-candidate-node",
    "candidate-gateway-disjoint-node",
  ])("accepts the %s direction", (direction) => {
    const evidence =
      direction === "candidate-gateway-disjoint-node"
        ? validMismatchEvidence()
        : validPassEvidence();
    evidence.direction = direction;

    expect(validateGatewayNodeCompatEvidence(evidence)).toBe(evidence);
  });

  it.each([
    ["root", (value: Record<string, any>) => (value.extra = true)],
    ["connection", (value: Record<string, any>) => (value.connection.extra = true)],
    ["gateway", (value: Record<string, any>) => (value.gateway.extra = true)],
    [
      "gateway package",
      (value: Record<string, any>) => (value.gateway.packagedArtifact.extra = true),
    ],
    [
      "gateway Actions artifact",
      (value: Record<string, any>) => (value.gateway.packagedArtifact.actionsArtifact.extra = true),
    ],
    [
      "gateway installed runtime",
      (value: Record<string, any>) => (value.gateway.installedRuntime.extra = true),
    ],
    ["node", (value: Record<string, any>) => (value.node.extra = true)],
    ["protocol", (value: Record<string, any>) => (value.protocol.extra = true)],
    ["operation", (value: Record<string, any>) => (value.operation.extra = true)],
    ["operation result", (value: Record<string, any>) => (value.operation.result.extra = true)],
    ["result", (value: Record<string, any>) => (value.result.extra = true)],
    ["producer", (value: Record<string, any>) => (value.producer.extra = true)],
  ])("rejects unknown keys at the %s level", (_label, mutate) => {
    const evidence = validPassEvidence();
    mutate(evidence);

    expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(/not allowed/u);
  });

  it.each([
    ["case ID", (value: Record<string, any>) => delete value.caseId],
    ["connection", (value: Record<string, any>) => delete value.connection.mode],
    [
      "package artifact",
      (value: Record<string, any>) => delete value.gateway.packagedArtifact.sha256,
    ],
    [
      "Actions artifact",
      (value: Record<string, any>) => delete value.gateway.packagedArtifact.actionsArtifact.digest,
    ],
    [
      "installed runtime",
      (value: Record<string, any>) => delete value.gateway.installedRuntime.identitySha256,
    ],
    ["node", (value: Record<string, any>) => delete value.node.kind],
    ["protocol", (value: Record<string, any>) => delete value.protocol.helloProtocol],
    ["operation", (value: Record<string, any>) => delete value.operation.command],
    ["result", (value: Record<string, any>) => delete value.result.completedAt],
    ["producer", (value: Record<string, any>) => delete value.producer.job],
  ])("rejects missing keys at the %s level", (_label, mutate) => {
    const evidence = validPassEvidence();
    mutate(evidence);

    expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(/is required/u);
  });

  it("requires a stable bounded case ID and supported direction", () => {
    for (const caseId of ["Linux-X64", "-leading", "contains/slash", "x".repeat(129)]) {
      const evidence = validPassEvidence();
      evidence.caseId = caseId;
      expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(/caseId/u);
    }

    const direction = validPassEvidence();
    direction.direction = "old-to-new";
    expect(() => validateGatewayNodeCompatEvidence(direction)).toThrow(/direction is unsupported/u);
  });

  it("requires direct Gateway WebSocket role=node mode=node", () => {
    for (const [field, value, message] of [
      ["transport", "watch-node-http", /transport must be gateway-websocket/u],
      ["role", "operator", /role must be node/u],
      ["mode", "ui", /mode must be node/u],
    ] as const) {
      const evidence = validPassEvidence();
      evidence.connection[field] = value;
      expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(message);
    }
  });

  it.each([
    ["android", "openclaw-android"],
    ["ios", "openclaw-ios"],
    ["linux", "node-host"],
    ["macos", "openclaw-macos"],
    ["windows", "node-host"],
  ])("accepts the %s direct node client", (kind, protocolClientId) => {
    const evidence = validPassEvidence();
    evidence.node.kind = kind;
    evidence.node.protocolClientId = protocolClientId;

    expect(validateGatewayNodeCompatEvidence(evidence)).toBe(evidence);
  });

  it.each(["watchos", "wearos"])("rejects the %s non-WebSocket-node topology", (kind) => {
    const evidence = validPassEvidence();
    evidence.node.kind = kind;

    expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(/node.kind is unsupported/u);
  });

  it("rejects removed proxy concepts and incorrect client topology", () => {
    const proxy = validPassEvidence();
    proxy.node.proxy = { kind: "android" };
    expect(() => validateGatewayNodeCompatEvidence(proxy)).toThrow(/node.proxy is not allowed/u);

    const wrongClient = validPassEvidence();
    wrongClient.node.kind = "windows";
    wrongClient.node.protocolClientId = "openclaw-ios";
    expect(() => validateGatewayNodeCompatEvidence(wrongClient)).toThrow(
      /windows nodes require protocol client node-host/u,
    );
  });

  it("requires lowercase package, runtime, source, and Actions identities", () => {
    const invalidCases: Array<[string, (value: Record<string, any>) => void, RegExp]> = [
      [
        "source SHA",
        (value) => (value.gateway.packagedArtifact.sourceSha = "A".repeat(40)),
        /sourceSha is invalid/u,
      ],
      [
        "package SHA",
        (value) => (value.node.packagedArtifact.sha256 = "D".repeat(64)),
        /sha256 is invalid/u,
      ],
      [
        "runtime identity",
        (value) => (value.node.installedRuntime.identitySha256 = "z".repeat(64)),
        /identitySha256 is invalid/u,
      ],
      [
        "Actions digest",
        (value) => (value.gateway.packagedArtifact.actionsArtifact.digest = "b".repeat(64)),
        /digest is invalid/u,
      ],
    ];
    for (const [_label, mutate, message] of invalidCases) {
      const evidence = validPassEvidence();
      mutate(evidence);
      expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(message);
    }
  });

  it("requires complete positive Actions artifact binding", () => {
    for (const [field, value] of [
      ["id", 0],
      ["sizeBytes", 0],
      ["runAttempt", 0],
      ["runId", "01"],
    ] as const) {
      const evidence = validPassEvidence();
      evidence.gateway.packagedArtifact.actionsArtifact[field] = value;
      expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(
        /positive integer|is invalid/u,
      );
    }

    for (const name of ["../candidate", "artifact/candidate", "artifact\\candidate", ".", ".."]) {
      const evidence = validPassEvidence();
      evidence.gateway.packagedArtifact.actionsArtifact.name = name;
      expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(/must be a basename/u);
    }
  });

  it("separates package and installed runtime identity while binding version and source", () => {
    const version = validPassEvidence();
    version.node.installedRuntime.version = "v2026.8.6";
    expect(() => validateGatewayNodeCompatEvidence(version)).toThrow(
      /installedRuntime.version must match packaged artifact version/u,
    );

    const source = validPassEvidence();
    source.gateway.installedRuntime.sourceSha = "f".repeat(40);
    expect(() => validateGatewayNodeCompatEvidence(source)).toThrow(
      /installedRuntime.sourceSha must match packaged artifact sourceSha/u,
    );

    const distinctIdentity = validPassEvidence();
    expect(distinctIdentity.gateway.installedRuntime.identitySha256).not.toBe(
      distinctIdentity.gateway.packagedArtifact.sha256,
    );
    expect(validateGatewayNodeCompatEvidence(distinctIdentity)).toBe(distinctIdentity);
  });

  it("requires positive ordered observed protocol fields", () => {
    const zero = validPassEvidence();
    zero.protocol.gatewayProtocolVersion = 0;
    expect(() => validateGatewayNodeCompatEvidence(zero)).toThrow(/positive integer/u);

    const gatewayRange = validPassEvidence();
    gatewayRange.protocol.gatewayAcceptedNodeMin = 5;
    expect(() => validateGatewayNodeCompatEvidence(gatewayRange)).toThrow(
      /must not exceed protocol.gatewayProtocolVersion/u,
    );

    const nodeRange = validPassEvidence();
    nodeRange.protocol.protocolClientAdvertisedMin = 4;
    nodeRange.protocol.protocolClientAdvertisedMax = 3;
    expect(() => validateGatewayNodeCompatEvidence(nodeRange)).toThrow(
      /must not exceed protocol.protocolClientAdvertisedMax/u,
    );
  });

  it("does not infer outcomes from generic protocol-range overlap", () => {
    const observedPass = validPassEvidence();
    observedPass.protocol.protocolClientAdvertisedMin = 5;
    observedPass.protocol.protocolClientAdvertisedMax = 5;
    expect(validateGatewayNodeCompatEvidence(observedPass)).toBe(observedPass);

    const observedMismatch = validMismatchEvidence();
    observedMismatch.protocol.protocolClientAdvertisedMin = 3;
    observedMismatch.protocol.protocolClientAdvertisedMax = 4;
    expect(validateGatewayNodeCompatEvidence(observedMismatch)).toBe(observedMismatch);
  });

  it("rejects pass evidence without a matching hello and successful system.which invoke", () => {
    const staleHello = validPassEvidence();
    staleHello.protocol.helloProtocol = 3;
    expect(() => validateGatewayNodeCompatEvidence(staleHello)).toThrow(
      /helloProtocol to equal gatewayProtocolVersion/u,
    );

    for (const [mutate, message] of [
      [(value: Record<string, any>) => (value.operation = null), /operation must be an object/u],
      [
        (value: Record<string, any>) => (value.operation.method = "gateway.status"),
        /method must be node.invoke/u,
      ],
      [
        (value: Record<string, any>) => (value.operation.command = "system.run"),
        /command must be system.which/u,
      ],
      [
        (value: Record<string, any>) => (value.operation.params.bins = []),
        /must contain 1 to 32 requested binaries/u,
      ],
      [
        (value: Record<string, any>) => (value.operation.params.bins = ["node", "node"]),
        /must not contain duplicates/u,
      ],
      [(value: Record<string, any>) => (value.operation.ok = false), /operation.ok must be true/u],
      [
        (value: Record<string, any>) => (value.operation.result.bins = {}),
        /must contain 1 to 32 resolved binaries/u,
      ],
      [
        (value: Record<string, any>) => (value.operation.result.bins.node = ""),
        /bounded non-control string/u,
      ],
      [
        (value: Record<string, any>) => (value.operation.result.bins = { bun: "/usr/bin/bun" }),
        /was not requested/u,
      ],
    ] as const) {
      const evidence = validPassEvidence();
      mutate(evidence);
      expect(() => validateGatewayNodeCompatEvidence(evidence)).toThrow(message);
    }
  });

  it("rejects false-green protocol mismatch evidence", () => {
    const hello = validMismatchEvidence();
    hello.protocol.helloProtocol = 4;
    expect(() => validateGatewayNodeCompatEvidence(hello)).toThrow(/helloProtocol to be null/u);

    const operation = validMismatchEvidence();
    operation.operation = clone(validPassEvidence().operation);
    expect(() => validateGatewayNodeCompatEvidence(operation)).toThrow(/operation to be null/u);

    const code = validMismatchEvidence();
    code.result.failureCode = "AUTH_FAILED";
    expect(() => validateGatewayNodeCompatEvidence(code)).toThrow(/PROTOCOL_MISMATCH/u);

    const phase = validMismatchEvidence();
    phase.result.failurePhase = "websocket-handshake";
    expect(() => validateGatewayNodeCompatEvidence(phase)).toThrow(/failurePhase connect/u);

    const missingCode = validMismatchEvidence();
    delete missingCode.result.failureCode;
    expect(() => validateGatewayNodeCompatEvidence(missingCode)).toThrow(
      /result.failureCode is required/u,
    );
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
      operation: clone(evidence.operation),
      gateway: clone(evidence.gateway),
      direction: evidence.direction,
      connection: clone(evidence.connection),
      caseId: evidence.caseId,
    };

    const canonical = canonicalizeGatewayNodeCompatEvidence(shuffled);
    const expected = `{
  "caseId": "linux-x64-candidate-gateway-baseline-node",
  "connection": {
    "mode": "node",
    "role": "node",
    "transport": "gateway-websocket"
  },
  "direction": "candidate-gateway-baseline-node",
  "gateway": {
    "installedRuntime": {
      "identitySha256": "2222222222222222222222222222222222222222222222222222222222222222",
      "sourceSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "version": "v2026.8.6"
    },
    "packagedArtifact": {
      "actionsArtifact": {
        "digest": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        "id": 1111,
        "name": "openclaw-candidate.tgz-input",
        "runAttempt": 2,
        "runId": "111111111",
        "sizeBytes": 4096
      },
      "name": "openclaw-candidate.tgz",
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "sourceSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "version": "v2026.8.6"
    }
  },
  "node": {
    "architecture": "x64",
    "installedRuntime": {
      "identitySha256": "4444444444444444444444444444444444444444444444444444444444444444",
      "sourceSha": "cccccccccccccccccccccccccccccccccccccccc",
      "version": "v2026.5.7"
    },
    "kind": "linux",
    "packagedArtifact": {
      "actionsArtifact": {
        "digest": "sha256:3333333333333333333333333333333333333333333333333333333333333333",
        "id": 3333,
        "name": "openclaw-baseline.tgz-input",
        "runAttempt": 2,
        "runId": "333333333",
        "sizeBytes": 4096
      },
      "name": "openclaw-baseline.tgz",
      "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "sourceSha": "cccccccccccccccccccccccccccccccccccccccc",
      "version": "v2026.5.7"
    },
    "protocolClientId": "node-host"
  },
  "operation": {
    "command": "system.which",
    "method": "node.invoke",
    "ok": true,
    "params": {
      "bins": [
        "node"
      ]
    },
    "result": {
      "bins": {
        "node": "/usr/bin/node"
      }
    }
  },
  "producer": {
    "job": "gateway-node-compat-linux-x64",
    "repository": "openclaw/openclaw",
    "runAttempt": 2,
    "runId": "123456789",
    "workflowPath": ".github/workflows/openclaw-cross-os-release-checks-reusable.yml",
    "workflowSha": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  },
  "protocol": {
    "gatewayAcceptedNodeMin": 3,
    "gatewayProtocolVersion": 4,
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
    evidence.gateway.packagedArtifact.version = "x".repeat(65 * 1024);

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
    invalid.operation.ok = false;
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
