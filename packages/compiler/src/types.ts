import type {
  ContextItem,
  ErrorItem,
  ItemArrayKey,
  Objective,
  OutputContract,
  SecurityPolicy,
} from "@ulcs/core";

export type DropReason =
  "below-relevance-threshold" | "expired" | "excluded-by-sensitivity" | "over-budget" | "duplicate";

export interface DroppedItemRecord {
  arrayKey: ItemArrayKey;
  id: string;
  reason: DropReason;
}

export interface CompiledItem {
  item: ContextItem;
  estimatedTokens: number;
  required: boolean;
  truncated: boolean;
  summarized: boolean;
}

export interface CompiledSection {
  key: ItemArrayKey;
  title: string;
  items: CompiledItem[];
  estimatedTokens: number;
}

export interface TokenBudgetSummary {
  maxContextTokens?: number;
  reservedOutputTokens?: number;
  effectiveInputBudget?: number;
  tokenizerName: string;
}

export interface CompiledContext {
  envelopeId: string;
  schemaVersion: string;
  compiledAt: string;
  objective?: Objective;
  sections: CompiledSection[];
  outputContract?: OutputContract;
  security?: SecurityPolicy;
  tokenBudget: TokenBudgetSummary;
  totalEstimatedTokens: number;
  droppedItems: DroppedItemRecord[];
  warnings: ErrorItem[];
  errors: ErrorItem[];
}
