/**
 * Typed error hierarchy for @ulcs/ingest. `exitCode` maps directly onto the
 * `ulcs ingest` CLI's documented exit codes so the CLI layer never has to
 * re-classify errors by string matching.
 */

export type IngestErrorCode =
  | "unsupported-format"
  | "ambiguous-format"
  | "extraction-failed"
  | "security-rejected"
  | "validation-failed"
  | "usage-error"
  | "not-found"
  | "capability-unavailable";

export interface IngestErrorOptions {
  code: IngestErrorCode;
  exitCode: number;
  cause?: unknown;
  context?: Record<string, unknown>;
}

export class IngestError extends Error {
  readonly code: IngestErrorCode;
  readonly exitCode: number;
  readonly context?: Record<string, unknown>;

  constructor(message: string, options: IngestErrorOptions) {
    super(message);
    this.name = "IngestError";
    this.code = options.code;
    this.exitCode = options.exitCode;
    this.context = options.context;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export class UnsupportedFormatError extends IngestError {
  constructor(message: string, availableExtractors: string[], context?: Record<string, unknown>) {
    super(
      `${message} Available extractors: ${availableExtractors.join(", ") || "(none registered)"}.`,
      {
        code: "unsupported-format",
        exitCode: 2,
        context,
      },
    );
    this.name = "UnsupportedFormatError";
  }
}

export class AmbiguousFormatError extends IngestError {
  constructor(message: string, candidates: string[], context?: Record<string, unknown>) {
    super(`${message} Candidates: ${candidates.join(", ")}. Pass --type to disambiguate.`, {
      code: "ambiguous-format",
      exitCode: 2,
      context,
    });
    this.name = "AmbiguousFormatError";
  }
}

export class ExtractionError extends IngestError {
  constructor(message: string, cause?: unknown, context?: Record<string, unknown>) {
    super(message, { code: "extraction-failed", exitCode: 3, cause, context });
    this.name = "ExtractionError";
  }
}

export class SecurityRejectionError extends IngestError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: "security-rejected", exitCode: 4, context });
    this.name = "SecurityRejectionError";
  }
}

export class ValidationFailedError extends IngestError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: "validation-failed", exitCode: 1, context });
    this.name = "ValidationFailedError";
  }
}

export class UsageError extends IngestError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: "usage-error", exitCode: 2, context });
    this.name = "UsageError";
  }
}

export class NotFoundError extends IngestError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: "not-found", exitCode: 2, context });
    this.name = "NotFoundError";
  }
}

export class CapabilityUnavailableError extends IngestError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: "capability-unavailable", exitCode: 2, context });
    this.name = "CapabilityUnavailableError";
  }
}

/** Directory ingestion completed but one or more files failed (`--on-error continue`). */
export class PartialDirectoryFailureError extends IngestError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: "extraction-failed", exitCode: 5, context });
    this.name = "PartialDirectoryFailureError";
  }
}
