/**
 * Front door for chats + memory session state.
 */

export type { ChatSpec } from "./session/chat-store.js"
export {
  createChat,
  createChildSession,
  createWorkerSession,
  deleteAllChats,
  deleteChat,
  isChildSession,
  latestChat,
  listAllChats,
  listChildSessions,
  listChats,
  listWorkerSessions,
  loadMessages,
  loadSession,
  loadSpec,
  nameChat,
  renameChat,
  saveChat,
  saveSessionSpec,
  setTabTitle,
  workspaceOf,
} from "./session/chat-store.js"
export { MAX_CHILDREN, listChildIds, readChildrenRegistry, registerChild, unregisterChild } from "./session/children.js"
export type { ChildrenRegistry } from "./session/children.js"
export type { MemoryEntry, MemorySpec } from "./session/memory.js"
export {
  listMemory,
  memoryDigest,
  memoryThread,
  readMemory,
  searchMemory,
  writeMemory,
} from "./session/memory.js"
