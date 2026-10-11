/**
 * Front door for chats + memory session state.
 */

export type { ChatSpec } from "./session/chat-store.js"
export {
  createChat,
  deleteAllChats,
  deleteChat,
  latestChat,
  listAllChats,
  listChats,
  loadMessages,
  loadSpec,
  nameChat,
  renameChat,
  saveChat,
  setTabTitle,
} from "./session/chat-store.js"
export type { MemoryEntry, MemorySpec } from "./session/memory.js"
export {
  listMemory,
  memoryDigest,
  memoryThread,
  readMemory,
  searchMemory,
  writeMemory,
} from "./session/memory.js"
