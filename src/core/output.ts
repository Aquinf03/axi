/**
 * Front door for structured CLI/slash output snapshots.
 */

export type { DoctorCheck, OutputFormat, ProviderRow, ChatRow } from "./output/snapshots.js"
export {
  AskSnapshot,
  ChatListSnapshot,
  DoctorSnapshot,
  HelpSnapshot,
  ProviderListSnapshot,
  SlashHelpSnapshot,
  VersionSnapshot,
  renderSnapshot,
} from "./output/snapshots.js"
