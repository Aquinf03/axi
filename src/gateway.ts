/**
 * Front door for provider transport + credentials.
 * Outside code imports this file only — not `gateway/*.ts` internals.
 *
 * New session / permission policy belongs in `core/`, not here.
 * Menus and slash parsing still live beside the provider for now; do not add more.
 */

export type { ChatImage } from "./gateway/provider.js"
export type {
  AgentToolJson,
  ChatMsg,
  Choice,
  MenuId,
  ProviderId,
  SlashOpts,
  SlashResult,
  StreamOut,
} from "./gateway/provider.js"
export {
  CATALOG,
  SLASH,
  activeId,
  activeLabel,
  applyChoice,
  contextWindow,
  entry,
  hasCreds,
  listText,
  menuChoices,
  notifyEnabled,
  parseProvider,
  providerCmd,
  runSlash,
  setActive,
  setKey,
  setModel,
  setNotify,
  setSound,
  setTemperature,
  slashMatches,
  soundEnabled,
  streamChat,
  streamTurn,
  temperature,
  temperatureBody,
  temperatureLabel,
  toggleNotify,
  toggleSound,
} from "./gateway/provider.js"
