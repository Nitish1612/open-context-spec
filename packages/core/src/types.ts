/**
 * Canonical TypeScript mirror of the ULCS v1 JSON Schemas in /schemas/v1.
 * Keep in sync with schemas/v1/*.schema.json — see tests/conformance for
 * cross-checks between this file and the schemas.
 */

export type Timestamp = string;
export type Identifier = string;

export type Status = "confirmed" | "unconfirmed" | "disputed" | "retracted" | "superseded";
export type TrustLevel = "trusted" | "semi-trusted" | "untrusted" | "unknown";
export type SensitivityLevel =
  "public" | "internal" | "confidential" | "restricted" | "personal" | "secret";
export type HandlingRuleName =
  "allow" | "redact" | "summarize" | "exclude" | "require-consent" | "local-only";
export type SourceType =
  | "user"
  | "system"
  | "developer"
  | "application"
  | "tool"
  | "retrieved-document"
  | "web-page"
  | "email"
  | "database"
  | "memory-store"
  | "model-output"
  | "unknown";
export type InstructionAuthority =
  "system" | "developer" | "application" | "user" | "tool" | "retrieved-content";
export type VerificationStatus = "unverified" | "verified" | "disputed" | "failed";
export type ConstraintType = "must" | "must-not" | "should" | "should-not";
export type MemoryType = "episodic" | "semantic" | "procedural" | "profile";
export type ConversationRole = "user" | "assistant" | "system" | "tool";
export type ToolOutcome = "success" | "error";
export type ErrorSeverity = "warning" | "error" | "fatal";
export type ActorType = "human" | "ai-agent" | "system" | "organization";
export type TaskStatus = "pending" | "in-progress" | "blocked" | "completed" | "cancelled";

export type Extensions = Record<string, unknown>;

export interface RelationshipRef {
  type: string;
  targetId: Identifier;
}

export interface HandlingRule {
  rule: HandlingRuleName;
  appliesTo?: string;
  notes?: string;
}

export interface SensitivityLabel {
  level: SensitivityLevel;
  categories?: string[];
  handling?: HandlingRule[];
}

export interface TrustLabel {
  level: TrustLevel;
  providesData?: boolean;
  providesInstructions?: boolean;
  rationale?: string;
}

export interface TransformationStep {
  operation: string;
  timestamp?: Timestamp;
  actor?: string;
}

export interface Citation {
  "@type": "Citation";
  id?: Identifier;
  sourceId?: string;
  uri?: string;
  title?: string;
  author?: string;
  publishedAt?: Timestamp;
  excerpt?: string;
  locator?: string;
}

export interface ProvenanceSignature {
  alg: string;
  publicKeyId?: string;
  signature: string;
}

export interface Provenance {
  sourceUri?: string;
  sourceId?: string;
  sourceType?: SourceType;
  author?: string;
  retrievedAt?: Timestamp;
  contentTimestamp?: Timestamp;
  contentHash?: string;
  citation?: Citation;
  transformations?: TransformationStep[];
  confidence?: number;
  verificationStatus?: VerificationStatus;
  signature?: ProvenanceSignature;
}

export interface ContextItemBase {
  id: Identifier;
  "@type": string;
  content?: string;
  status?: Status;
  priority?: number;
  relevance?: number;
  scope?: string[];
  validFrom?: Timestamp;
  validUntil?: Timestamp | null;
  source?: Provenance;
  trust?: TrustLabel;
  sensitivity?: SensitivityLabel;
  tags?: string[];
  relationships?: RelationshipRef[];
  tokenEstimate?: number;
  extensions?: Extensions;
}

export interface Objective extends ContextItemBase {
  "@type": "Objective";
  summary?: string;
  successCriteria?: string[];
  nonGoals?: string[];
}

export interface Task extends ContextItemBase {
  "@type": "Task";
  name: string;
  taskStatus?: TaskStatus;
  parentTaskId?: string | null;
}

export interface Actor extends ContextItemBase {
  "@type": "Actor";
  role: string;
  displayName?: string;
  actorType?: ActorType;
}

export interface Entity extends ContextItemBase {
  "@type": "Entity";
  name: string;
  entityType: string;
  properties?: Record<string, unknown>;
  sameAs?: string[];
}

export interface Relationship extends ContextItemBase {
  "@type": "Relationship";
  subjectId: Identifier;
  predicate: string;
  objectId: Identifier;
  confidence?: number;
}

export interface Instruction extends ContextItemBase {
  "@type": "Instruction";
  content: string;
  authority: InstructionAuthority;
  conflictsWith?: Identifier[];
  precedenceNotes?: string;
}

export interface Fact extends ContextItemBase {
  "@type": "Fact";
  content: string;
}

export interface Assumption extends ContextItemBase {
  "@type": "Assumption";
  content: string;
}

export interface Constraint extends ContextItemBase {
  "@type": "Constraint";
  content: string;
  constraintType: ConstraintType;
}

export interface Preference extends ContextItemBase {
  "@type": "Preference";
  content: string;
  strength?: number;
}

export interface Decision extends ContextItemBase {
  "@type": "Decision";
  content: string;
  decidedBy?: string;
  decidedAt?: Timestamp;
  rationale?: string;
  reversible?: boolean;
}

export interface Question extends ContextItemBase {
  "@type": "Question";
  content: string;
  askedBy?: string;
  resolved: boolean;
  answer?: string | null;
}

export interface ConversationMessage extends ContextItemBase {
  "@type": "ConversationMessage";
  role: ConversationRole;
  content: string;
  name?: string;
  timestamp?: Timestamp;
  toolCallId?: string;
}

export interface MemoryItem extends ContextItemBase {
  "@type": "MemoryItem";
  content: string;
  memoryType: MemoryType;
  importance?: number;
  lastAccessedAt?: Timestamp;
  decay?: number;
}

export interface Resource extends ContextItemBase {
  "@type": "Resource";
  uri?: string;
  mimeType?: string;
  title?: string;
  encoding?: "utf-8" | "base64";
}

export interface ToolDefinition extends ContextItemBase {
  "@type": "ToolDefinition";
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  sideEffects?: "none" | "read-only" | "write" | "external";
}

export interface ToolResult extends ContextItemBase {
  "@type": "ToolResult";
  toolCallId?: string;
  toolName: string;
  outcome: ToolOutcome;
  output: unknown;
  error?: string;
}

export interface ContextSummary extends ContextItemBase {
  "@type": "ContextSummary";
  content: string;
  summarizedItemIds: Identifier[];
  method?: string;
}

export interface ErrorItem {
  "@type": "Error";
  id?: Identifier;
  code: string;
  message: string;
  itemId?: Identifier;
  severity: ErrorSeverity;
  extensions?: Extensions;
}

/** Any item that can appear inside one of the envelope's item arrays. */
export type ContextItem =
  | Objective
  | Task
  | Actor
  | Entity
  | Relationship
  | Instruction
  | Fact
  | Assumption
  | Constraint
  | Preference
  | Decision
  | Question
  | ConversationMessage
  | MemoryItem
  | Resource
  | ToolDefinition
  | ToolResult
  | ContextSummary;

export interface OutputContract {
  "@type"?: "OutputContract";
  format?: "text" | "json" | "markdown" | "custom";
  schema?: Record<string, unknown>;
  constraints?: string[];
  mustInclude?: string[];
  mustAvoid?: string[];
  language?: string;
  maxLength?: number;
}

export interface SecurityPolicy {
  "@type"?: "SecurityPolicy";
  defaultTrust?: TrustLevel;
  untrustedWrapping?: {
    enabled?: boolean;
    style?: "delimiter" | "xml-tag";
    delimiter?: string;
  };
  injectionMitigations?: string[];
  allowToolInstructions?: boolean;
  allowRetrievedContentInstructions?: boolean;
  dataExfiltrationControls?: string[];
  notes?: string;
}

export interface TokenPolicy {
  "@type"?: "TokenPolicy";
  maxContextTokens?: number;
  reservedOutputTokens?: number;
  sectionBudgets?: Record<string, number>;
  relevanceThreshold?: number;
  deduplicate?: boolean;
  allowSummarization?: boolean;
  allowTruncation?: boolean;
  requiredItemIds?: Identifier[];
  tokenEstimationMethod?: "approx-char4" | "custom";
}

/** Envelope array keys that hold ContextItem[] (excludes objective/summary/policy singletons). */
export const ITEM_ARRAY_KEYS = [
  "actors",
  "instructions",
  "facts",
  "assumptions",
  "constraints",
  "preferences",
  "decisions",
  "questions",
  "conversation",
  "resources",
  "entities",
  "relationships",
  "memory",
  "tools",
  "toolResults",
] as const;

export type ItemArrayKey = (typeof ITEM_ARRAY_KEYS)[number];

export interface ContextEnvelope {
  "@context": string | Record<string, unknown> | unknown[];
  "@type": "ContextEnvelope";
  schemaVersion: string;
  id: Identifier;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  objective?: Objective;
  actors?: Actor[];
  instructions?: Instruction[];
  facts?: Fact[];
  assumptions?: Assumption[];
  constraints?: Constraint[];
  preferences?: Preference[];
  decisions?: Decision[];
  questions?: Question[];
  conversation?: ConversationMessage[];
  resources?: Resource[];
  entities?: Entity[];
  relationships?: Relationship[];
  memory?: MemoryItem[];
  tools?: ToolDefinition[];
  toolResults?: ToolResult[];
  outputContract?: OutputContract;
  security?: SecurityPolicy;
  tokenPolicy?: TokenPolicy;
  summary?: ContextSummary | null;
  errors?: ErrorItem[];
  extensions?: Extensions;
}

export interface JsonPatchOperation {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  from?: string;
  value?: unknown;
}

/**
 * Type-safe-ish helper for writing to one of the envelope's item arrays
 * when the key is only known as `ItemArrayKey` (not a literal) — e.g. in a
 * loop over `ITEM_ARRAY_KEYS`. TypeScript's indexed-assignment checking
 * requires the assigned value to satisfy the *intersection* of every
 * possible array type for a union key, which a real `ContextItem[]` never
 * does; this helper documents that one, deliberate, narrow cast instead of
 * scattering `as unknown as ...` casts across every call site.
 */
export function setItemArray(
  envelope: ContextEnvelope,
  key: ItemArrayKey,
  items: ContextItem[],
): void {
  (envelope as unknown as Record<ItemArrayKey, ContextItem[]>)[key] = items;
}

export interface ContextPatch {
  "@type": "ContextPatch";
  id: Identifier;
  targetId?: Identifier;
  createdAt?: Timestamp;
  description?: string;
  operations: JsonPatchOperation[];
}

export interface ConflictReport {
  itemId: Identifier;
  arrayKey: ItemArrayKey;
  reason: "content-mismatch" | "type-mismatch";
  itemFromA: ContextItem;
  itemFromB: ContextItem;
  resolution: "kept-both";
  keptId: Identifier;
}

export interface MergeResult {
  merged: ContextEnvelope;
  conflicts: ConflictReport[];
}
