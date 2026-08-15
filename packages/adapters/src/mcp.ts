import type { ContextEnvelope } from "@ulcs/core";
import type { CompiledContext } from "@ulcs/compiler";

export interface MCPResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export interface ToMCPResourceOptions {
  uri?: string;
}

/**
 * Renders a ContextEnvelope or CompiledContext as an MCP resource content
 * block — full-fidelity JSON, no information loss at this layer. The MCP
 * host performs whatever further collapse it needs; ULCS does not assume
 * anything about MCP transport or capability negotiation. See
 * specification/v1/interoperability.md#1.
 */
export function toMCPResource(
  data: ContextEnvelope | CompiledContext,
  options: ToMCPResourceOptions = {},
): MCPResourceContent {
  const id = "id" in data ? data.id : data.envelopeId;
  return {
    uri: options.uri ?? `urn:ulcs:mcp-resource:${id}`,
    mimeType: "application/json",
    text: JSON.stringify(data, null, 2),
  };
}
