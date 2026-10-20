/**
 * Front door for config resolution.
 * Precedence: env > profile workspace > profile global > project > defaults.
 */

export {
  DEFAULT_MAX_AGENT_STEPS,
  DEFAULT_MAX_TOOL_RESULT_BYTES,
  DEFAULT_PERMISSION_MODE,
} from "./config/defaults.js"
export { loadProjectConfig, ignoredProjectKeys, projectConfigPath } from "./config/project.js"
export {
  addSavedRule,
  loadProfileConfig,
  removeSavedRule,
  saveProfileConfig,
  savedRules,
  setPermissionModeGlobal,
  setPermissionModeWorkspace,
  settingsPath,
  workspaceOverride,
  type SaveProfileOpts,
} from "./config/profile.js"
export {
  approvePendingConfig,
  clearPendingConfig,
  configGateEnabled,
  configGateStatusText,
  denyPendingConfig,
  formatPendingConfigDiff,
  loadPendingConfig,
  pendingConfigPath,
  pendingConfigStatusText,
  proposeConfigWrite,
  setConfigGate,
  type PendingConfig,
  type PendingConfigWrite,
  type ProposeWriteInput,
  type ProposeWriteResult,
} from "./config/pending.js"
export { atomicWriteText, backupIfExists, configBackupsDir } from "./config/atomic.js"
export { resolveConfig, type ResolvedRuntime } from "./config/resolve.js"
export {
  PROJECT_SAFE_KEYS,
  type ConfigSource,
  type ProfileConfig,
  type ProjectConfig,
  type ResolvedConfig,
} from "./config/types.js"
