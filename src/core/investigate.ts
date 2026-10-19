/**
 * Front door for the investigation graph.
 * Outside code imports this file only — not `investigate/*.ts` internals.
 */

export {
  INVESTIGATE_EDGE_KINDS,
  INVESTIGATE_FILE,
  INVESTIGATE_NODE_KINDS,
  INVESTIGATE_SCHEMA,
  INVESTIGATE_STATUSES,
  MAX_INVESTIGATE_EDGES,
  MAX_INVESTIGATE_NODES,
  type InvestigateEdge,
  type InvestigateEdgeKind,
  type InvestigateGraph,
  type InvestigateNode,
  type InvestigateNodeKind,
  type InvestigateStatus,
} from "./investigate/types.js"

export { investigatePath } from "./investigate/paths.js"

export {
  abandonInvestigate,
  addInvestigateNode,
  clearInvestigate,
  countInvestigate,
  emptyInvestigateGraph,
  linkInvestigate,
  loadInvestigate,
  saveInvestigate,
  type AbandonInput,
  type AddNodeInput,
  type LinkInput,
  type LinkInvestigateResult,
} from "./investigate/store.js"

export {
  formatInvestigateGraph,
  investigatePromptBlock,
  investigateStatusText,
} from "./investigate/format.js"

export { runInvestigateSlash, type InvestigateSlashResult } from "./investigate/slash.js"
