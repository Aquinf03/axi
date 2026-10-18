/** Codemode — sticky Node scratchpad (opt-out; on by default). */

export const CODEMODE_DIR_NAME = "codemode"
export const CODEMODE_MODE_FILE = "mode.json"

export const DEFAULT_CODE_TIMEOUT_MS = 30_000
export const MAX_CODE_CHARS = 50_000
export const MAX_OUTPUT_CHARS = 24_000
export const MAX_VAR_ROWS = 40
export const MAX_VAR_PREVIEW = 80

export type CodemodeModeState = {
  /** When true, `codemode_run` may start/use the kernel. Default true. */
  enabled: boolean
}
