/**
 * Front door for factory — DAG of spawned subagents + live dock.
 * Outside code imports this file only — not `factory/*.ts` internals.
 */

export {
  FACTORY_DIR_NAME,
  FACTORY_FILE,
  FACTORY_SCHEMA,
  MAX_FACTORY_NODES,
  MAX_OUTPUT_CHARS,
  MAX_PARALLEL_DEFAULT,
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
  fillPrompt,
  outputsFromNodes,
  readyNodeIds,
  sanitizeMachine,
} from "./factory/dag.js"

export {
  ensureUserMachinesDir,
  formatMachineList,
  listMachines,
  resolveMachine,
  saveUserMachine,
  type MachineCard,
} from "./factory/machines.js"

export {
  factoryActive,
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
