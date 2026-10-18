/**
 * Front door for codemode — sticky Node scratchpad (on by default).
 * Outside code imports this file only — not `codemode/*.ts` internals.
 */

export {
  CODEMODE_DIR_NAME,
  CODEMODE_MODE_FILE,
  DEFAULT_CODE_TIMEOUT_MS,
  MAX_CODE_CHARS,
  MAX_OUTPUT_CHARS,
  MAX_VAR_PREVIEW,
  MAX_VAR_ROWS,
  type CodemodeModeState,
} from "./codemode/types.js"

export { globalCodemodeDir, globalCodemodeModePath } from "./codemode/paths.js"

export {
  codemodeEnabled,
  codemodeModeStatusText,
  emptyCodemodeMode,
  loadCodemodeMode,
  parseCodemodeModeArg,
  saveCodemodeMode,
  setCodemodeEnabled,
} from "./codemode/mode.js"

export {
  codemodeKernelRunning,
  codemodeReset,
  codemodeRun,
  codemodeStop,
  codemodeVars,
  stopAllCodemodeKernels,
  type CodemodeRunOpts,
} from "./codemode/kernel.js"

export { runCodemodeSlash, type CodemodeSlashResult } from "./codemode/slash.js"
