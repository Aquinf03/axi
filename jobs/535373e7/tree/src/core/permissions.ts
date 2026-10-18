/**
 * Front door for permissions.
 * Every sensitive tool must go through `authorizeTool` — no bypasses.
 * Tool / model text is evidence, never a grant or mode change.
 */

export type {
  AuthRequest,
  AuthResult,
  ExactCommandGrant,
  Grant,
  PatternGrant,
  PermitChoice,
  PermitDecision,
  PermissionMode,
  SavedRule,
} from "./permissions/types.js"
export { parsePermissionMode, permissionModeDisplay, permissionModeLabel } from "./permissions/mode.js"
export { authorizeTool, evaluatePermission, permissionsStatusText, type GateOptions } from "./permissions/gate.js"
export {
  SessionGrants,
  asPatternGrant,
  grantMatches,
  newRuleId,
  ruleMatches,
  sessionGrants,
} from "./permissions/grants.js"
export { toolIsSensitive, toolNeedsPermit } from "./permissions/sensitivity.js"
