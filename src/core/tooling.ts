/**
 * Front door for agent tooling.
 * Outside code imports this file only — not `tooling/*.ts` internals (except tests).
 */

export type { AgentToolDef } from "./tooling/tool_specs.js"
export {
  AGENT_TOOLS,
  CORE_TOOLS,
  DEFERRED_TOOLS,
  isDeferredTool,
} from "./tooling/tool_specs.js"
export {
  clearDeferredTools,
  deferredDigest,
  loadDeferredTools,
  loadedDeferredNames,
  loadedDeferredTools,
} from "./tooling/deferred.js"
export {
  clipToolLog,
  contextBlock,
  formatPermitDisplay,
  parseRunCommand,
  permitLabel,
  runAgentTool,
  runDetached,
  runShell,
  toolNeedsPermit,
  toolsForTrain,
  workspaceLines,
} from "./tooling/dispatch.js"
export {
  BUILTINS,
  catalog,
  formatCards,
  searchTools,
  toolsDigest,
  type ToolCard,
  type ToolSource,
} from "./tooling/registry.js"
