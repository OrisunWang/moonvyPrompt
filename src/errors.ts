import type { PipelineWarning, WarningSeverity } from "./types.js";

/** Error class that carries a stable code and safe user-facing hint. */
export class MoonvyUiPromptError extends Error {
  /** Stable machine-readable error code. */
  readonly code: string;
  /** Severity used by CLI exit handling. */
  readonly severity: WarningSeverity;
  /** Recovery hint that must not contain secrets. */
  readonly hint?: string;
  /** Process exit code used by the CLI wrapper. */
  readonly exitCode: number;

  /** Creates a typed CLI error without exposing credentials. */
  constructor(code: string, message: string, severity: WarningSeverity, exitCode: number, hint?: string) {
    super(message);
    this.name = "MoonvyUiPromptError";
    this.code = code;
    this.severity = severity;
    this.exitCode = exitCode;
    this.hint = hint;
  }

  /** Converts the error into a serializable warning shape. */
  toWarning(): PipelineWarning {
    return { code: this.code, severity: this.severity, message: this.message, hint: this.hint };
  }
}

/** Builds a usage error for invalid command arguments or URLs. */
export function usageError(code: string, message: string, hint?: string): MoonvyUiPromptError {
  return new MoonvyUiPromptError(code, message, "fatal", 2, hint);
}

/** Builds a configuration error for missing credentials or paths. */
export function configError(code: string, message: string, hint?: string): MoonvyUiPromptError {
  return new MoonvyUiPromptError(code, message, "fatal", 3, hint);
}

/** Builds an upstream access error without leaking response headers. */
export function upstreamError(code: string, message: string, hint?: string): MoonvyUiPromptError {
  return new MoonvyUiPromptError(code, message, "fatal", 4, hint);
}

/** Wraps unknown failures into a safe typed error. */
export function normalizeError(error: unknown): MoonvyUiPromptError {
  if (error instanceof MoonvyUiPromptError) {
    return error;
  }
  if (error instanceof Error) {
    return new MoonvyUiPromptError("INTERNAL_ERROR", error.message, "fatal", 1, "Run with a fixture or inspect raw files to isolate the failing stage.");
  }
  return new MoonvyUiPromptError("INTERNAL_ERROR", "Unknown internal error", "fatal", 1, "Run the command again with a smaller fixture.");
}

