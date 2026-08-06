export const GATEWAY_NODE_COMPAT_SCHEMA: "openclaw.gateway-node-compat/v1";

export type GatewayNodeKind = "android" | "ios" | "linux" | "macos" | "windows";

export type GatewayNodeArchitecture = "arm64" | "x64";

export type GatewayNodeCompatDirection =
  | "baseline-gateway-baseline-node"
  | "baseline-gateway-candidate-node"
  | "candidate-gateway-baseline-node"
  | "candidate-gateway-candidate-node"
  | "candidate-gateway-disjoint-node";

export type GatewayNodeCompatActionsArtifact = {
  id: number;
  name: string;
  digest: `sha256:${string}`;
  sizeBytes: number;
  runId: string;
  runAttempt: number;
};

export type GatewayNodeCompatPackagedArtifact = {
  version: string;
  sourceSha: string;
  name: string;
  sha256: string;
  actionsArtifact: GatewayNodeCompatActionsArtifact;
};

export type GatewayNodeCompatInstalledRuntime = {
  version: string;
  sourceSha: string;
  identitySha256: string;
};

export type GatewayNodeCompatRuntimeBinding = {
  packagedArtifact: GatewayNodeCompatPackagedArtifact;
  installedRuntime: GatewayNodeCompatInstalledRuntime;
};

type GatewayNodeCompatNodeBase = GatewayNodeCompatRuntimeBinding & {
  architecture: GatewayNodeArchitecture;
};

export type GatewayNodeCompatNode =
  | (GatewayNodeCompatNodeBase & {
      kind: "android";
      protocolClientId: "openclaw-android";
    })
  | (GatewayNodeCompatNodeBase & {
      kind: "ios";
      protocolClientId: "openclaw-ios";
    })
  | (GatewayNodeCompatNodeBase & {
      kind: "linux";
      protocolClientId: "node-host";
    })
  | (GatewayNodeCompatNodeBase & {
      kind: "macos";
      protocolClientId: "openclaw-macos";
    })
  | (GatewayNodeCompatNodeBase & {
      kind: "windows";
      protocolClientId: "node-host";
    });

export type GatewayNodeCompatProtocol = {
  gatewayProtocolVersion: number;
  gatewayAcceptedNodeMin: number;
  protocolClientAdvertisedMin: number;
  protocolClientAdvertisedMax: number;
  helloProtocol: number | null;
};

export type GatewayNodeCompatOperation = {
  method: "node.invoke";
  command: "system.which";
  params: {
    bins: string[];
  };
  ok: true;
  result: {
    bins: Record<string, string>;
  };
};

export type GatewayNodeCompatProducer = {
  repository: string;
  workflowPath: string;
  workflowSha: string;
  runId: string;
  runAttempt: number;
  job: string;
};

type GatewayNodeCompatBase = {
  schema: typeof GATEWAY_NODE_COMPAT_SCHEMA;
  caseId: string;
  direction: GatewayNodeCompatDirection;
  connection: {
    transport: "gateway-websocket";
    role: "node";
    mode: "node";
  };
  gateway: GatewayNodeCompatRuntimeBinding;
  node: GatewayNodeCompatNode;
  protocol: GatewayNodeCompatProtocol;
  producer: GatewayNodeCompatProducer;
};

export type GatewayNodeCompatPassedEvidence = GatewayNodeCompatBase & {
  protocol: GatewayNodeCompatProtocol & {
    helloProtocol: number;
  };
  operation: GatewayNodeCompatOperation;
  result: {
    outcome: "passed";
    startedAt: string;
    completedAt: string;
  };
};

export type GatewayNodeCompatMismatchEvidence = GatewayNodeCompatBase & {
  protocol: GatewayNodeCompatProtocol & {
    helloProtocol: null;
  };
  operation: null;
  result: {
    outcome: "protocol-mismatch";
    failureCode: "PROTOCOL_MISMATCH";
    failurePhase: "connect";
    startedAt: string;
    completedAt: string;
  };
};

export type GatewayNodeCompatEvidence =
  | GatewayNodeCompatPassedEvidence
  | GatewayNodeCompatMismatchEvidence;

export function validateGatewayNodeCompatEvidence(value: unknown): GatewayNodeCompatEvidence;

export function canonicalizeGatewayNodeCompatEvidence(value: unknown): string;
