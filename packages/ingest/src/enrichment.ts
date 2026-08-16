/**
 * Optional AI enrichment (facts, decisions, entities, relationships,
 * summaries extracted by a model) — defined but not implemented, and not
 * wired into any ingestion pipeline in this package. `ingest()` and its
 * siblings never call a model; `--no-llm` on the CLI is a guarantee, not a
 * toggle, because nothing here reaches for a `ContextEnricher`. This
 * interface exists so a host application can implement one against a stable
 * shape without this package taking on a provider SDK dependency.
 *
 * See docs/ingestion.md ("Optional AI enrichment") for the constraints any
 * implementation must follow — in particular: attach provenance to every
 * AI-generated item, and default AI-generated items to `status:
 * "unconfirmed"` (the closest existing `ContextItemBase.status` value —
 * the schema has no `"inferred"` value today; see @ulcs/core's
 * `ContextItemBase`).
 */
import type { ContextItem } from "@ulcs/core";
import type { ExtractedDocument, ResourceLimits } from "./types.js";

export interface EnrichmentOptions {
  /** Resource limits the enricher should respect (e.g. when calling an external model). */
  limits?: Partial<ResourceLimits>;
  /** Abort signal for cooperative cancellation / timeouts. */
  signal?: AbortSignal;
  /** Arbitrary host-supplied context (e.g. objective, locale) passed through to the enricher. */
  context?: Record<string, unknown>;
}

export interface ContextEnricher {
  readonly id: string;
  readonly name: string;
  enrich(document: ExtractedDocument, options?: EnrichmentOptions): Promise<ContextItem[]>;
}
