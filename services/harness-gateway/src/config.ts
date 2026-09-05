const MIN_SECRET_BYTES = 32;

export interface GatewayConfig {
  agentServiceSecret?: string;
  harnessUpstream: string;
  internalRunsUpstreamToken?: string;
  ownerUserId: string;
  port: number;
  secret: Uint8Array;
}

export function getGatewayConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const harnessUpstream = environment.HARNESS_UPSTREAM;
  const ownerUserId = environment.HARNESS_OWNER_USER_ID;
  const rawSecret = environment.HARNESS_EMBED_SECRET;
  const agentServiceSecret = environment.AGENT_SERVICE_SECRET || undefined;
  const internalRunsUpstreamToken = [
    environment.AGENT_UPSTREAM_SESSION_TOKEN,
    environment.HERMES_DASHBOARD_SESSION_TOKEN,
  ]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value));
  const port = Number(environment.PORT ?? "8787");

  if (!harnessUpstream) throw new Error("HARNESS_UPSTREAM is required");
  const upstreamUrl = new URL(harnessUpstream);
  if (upstreamUrl.protocol !== "http:" && upstreamUrl.protocol !== "https:") {
    throw new Error("HARNESS_UPSTREAM must be an HTTP(S) URL");
  }
  if (!ownerUserId) throw new Error("HARNESS_OWNER_USER_ID is required");
  if (!rawSecret || new TextEncoder().encode(rawSecret).length < MIN_SECRET_BYTES) {
    throw new Error("HARNESS_EMBED_SECRET must be at least 32 bytes");
  }
  if (
    agentServiceSecret &&
    new TextEncoder().encode(agentServiceSecret).length < MIN_SECRET_BYTES
  ) {
    throw new Error("AGENT_SERVICE_SECRET must be at least 32 bytes");
  }
  if (
    internalRunsUpstreamToken &&
    new TextEncoder().encode(internalRunsUpstreamToken).length < MIN_SECRET_BYTES
  ) {
    throw new Error("AGENT_UPSTREAM_SESSION_TOKEN must be at least 32 bytes");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }
  if (
    agentServiceSecret &&
    (
      agentServiceSecret === rawSecret ||
      agentServiceSecret === internalRunsUpstreamToken ||
      agentServiceSecret === environment.HARNESS_TOOL_SECRET?.trim()
    )
  ) {
    throw new Error(
      "AGENT_SERVICE_SECRET must be distinct from embed, upstream, and MCP secrets",
    );
  }

  return {
    ...(agentServiceSecret ? { agentServiceSecret } : {}),
    harnessUpstream: upstreamUrl.toString(),
    ...(internalRunsUpstreamToken ? { internalRunsUpstreamToken } : {}),
    ownerUserId,
    port,
    secret: new TextEncoder().encode(rawSecret),
  };
}
