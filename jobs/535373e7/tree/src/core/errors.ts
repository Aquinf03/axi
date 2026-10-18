/**
 * Typed runtime failures. Prefer these over bare `throw new Error(...)`.
 * Programmer bugs may still throw plain Error / TypeError.
 */

export type AxErrorKind =
  | "io"
  | "config"
  | "train"
  | "tool"
  | "provider"
  | "permission"
  | "parse"
  | "not_found"
  | "external"

export class AxError extends Error {
  readonly kind: AxErrorKind
  readonly cause?: unknown

  constructor(kind: AxErrorKind, message: string, cause?: unknown) {
    super(message)
    this.name = "AxError"
    this.kind = kind
    this.cause = cause
  }
}

export function isAxError(err: unknown): err is AxError {
  return err instanceof AxError
}

export function axMessage(err: unknown): string {
  if (err instanceof AxError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

/** Runtime failure (tool, io, provider). */
export function fail(kind: AxErrorKind, message: string, cause?: unknown): never {
  throw new AxError(kind, message, cause)
}

/** Programmer bug — should not be caught as a normal tool failure. */
export function bug(message: string): never {
  throw new Error(`[axi bug] ${message}`)
}
