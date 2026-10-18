/**
 * Front door for factory — DAG of spawned subagents + live dock.
 * Outside code imports this file only — not `factory/*.ts` internals.
 */

export {
  FACTORY_DIR_NAME,
  FACTORY_FILE,
  FACTORY_SCHEMA,
  MAX_FACTORY_NODES,
  MAX_FOREACH,
  MAX_LOOP_ENTRIES,
  MAX_OUTPUT_CHARS,
  MAX_PARALLEL_DEFAULT,
  type FactoryForeach,
  type FactoryGuard,
  type FactoryLoop,
  type FactoryMachineSpec,
  type FactoryNodeSpec,
  type FactoryNodeState,
  type FactoryNodeStatus,
  type FactoryRun,
  type FactoryRunStatus,
  type FactoryState,
} from "./factory/types.js"

export {
  bundledMachinesDir,
  factoryStatePath,
  globalFactoryDir,
  userMachinesDir,
} from "./factory/paths.js"

export {
  emptyFactory,
  loadFactory,
  saveFactory,
  sanitizeFactory,
  updateFactory,
} from "./factory/store.js"

export {
  countByStatus,
  depSatisfied,
  fillPrompt,
  outputsFromNodes,
  readyNodeIds,
  sanitizeMachine,
} from "./factory/dag.js"

export {
  evalGuard,
  extractList,
  joinGroupOutput,
  sanitizeGuard,
} from "./factory/guard.js"

export {
  isMachineMarkdownPath,
  parseMachineMarkdown,
} from "./factory/markdown.js"

export {
  ensureUserMachinesDir,
  formatMachineList,
  importMachineFile,
  listMachines,
  resolveMachine,
  saveUserMachine,
  type MachineCard,
} from "./factory/machines.js"

export {
  cancelFactoryNode,
  factoryActive,
  factoryNodeLog,
  startFactory,
  stopFactory,
  tickFactory,
  type StartFactoryOpts,
} from "./factory/executor.js"

export {
  formatFactoryDock,
  formatFactoryStatus,
  formatFactoryStrip,
  formatRunDock,
} from "./factory/status.js"

export { runFactorySlash, type FactorySlashResult } from "./factory/slash.js"
