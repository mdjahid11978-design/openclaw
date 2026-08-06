export const GATEWAY_NODE_COMPAT_SCHEMA: "openclaw.gateway-node-compat/v1";

export type GatewayNodeKind =
  | "android"
  | "ios"
  | "linux"
  | "macos"
  | "watchos"
  | "wearos"
  | "windows";

export type GatewayNodeArchitecture = "arm64" | "x64";

export type GatewayNodeConnectionMode = "direct" | "phone-proxy";

export type GatewayNodeProtocolClientId =
  | "node-host"
  | "openclaw-android"
  | "openclaw-ios"
  | "openclaw-macos"
  | "openclaw-watchos";

export type GatewayNodeCompatArtifact = {
  version: string;
  sourceSha: string;
  artifactName: string;
  artifactSha256: string;
};

export type GatewayNodeCompatProxy = GatewayNodeCompatArtifact & {
  kind: "android";
  architecture: GatewayNodeArchitecture;
  protocolClientId: "openclaw-android";
};

type GatewayNodeCompatDirectNode = GatewayNodeCompatArtifact & {
  architecture: GatewayNodeArchitecture;
  connectionMode: "direct";
  proxy?: never;
};

export type GatewayNodeCompatNode =
  | (GatewayNodeCompatDirectNode & {
      kind: "android";
      protocolClientId: "openclaw-android";
    })
  | (GatewayNodeCompatDirectNode & {
      kind: "ios";
      protocolClientId: "openclaw-ios";
    })
  | (GatewayNodeCompatDirectNode & {
      kind: "macos";
      protocolClientId: "openclaw-macos";
    })
  | (GatewayNodeCompatDirectNode & {
      kind: "watchos";
      protocolClientId: "openclaw-watchos";
    })
  | (GatewayNodeCompatDirectNode & {
      kind: "linux";
      protocolClientId: "node-host";
    })
  | (GatewayNodeCompatDirectNode & {
      kind: "windows";
      protocolClientId: "node-host";
    })
  | (GatewayNodeCompatArtifact & {
      kind: "wearos";
      architecture: GatewayNodeArchitecture;
      connectionMode: "phone-proxy";
      protocolClientId: "openclaw-android";
      proxy: GatewayNodeCompatProxy;
    });

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
  gateway: GatewayNodeCompatArtifact;
  node: GatewayNodeCompatNode;
  producer: GatewayNodeCompatProducer;
};

export type GatewayNodeCompatPassedEvidence = GatewayNodeCompatBase & {
  protocol: {
    gatewayCurrent: number;
    gatewayNodeMinimum: number;
    protocolClientAdvertisedMin: number;
    protocolClientAdvertisedMax: number;
    helloProtocol: number;
  };
  result: {
    outcome: "passed";
    startedAt: string;
    completedAt: string;
  };
};

export type GatewayNodeCompatMismatchEvidence = GatewayNodeCompatBase & {
  protocol: {
    gatewayCurrent: number;
    gatewayNodeMinimum: number;
    protocolClientAdvertisedMin: number;
    protocolClientAdvertisedMax: number;
    helloProtocol: null;
  };
  result: {
    outcome: "expected-protocol-mismatch";
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
