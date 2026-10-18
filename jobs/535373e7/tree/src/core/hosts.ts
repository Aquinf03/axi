/**
 * Front door for host surfaces.
 * Agent core and commands receive an injected HostEnv — no pbcopy/open in core.
 */

export type { HostEnv, MemoryHost } from "./hosts/surface.js"
export { createMemoryHost, isOpenableUrl, normalizeOpenUrl } from "./hosts/surface.js"
export { createNativeHost } from "./hosts/native.js"
export { createAskHost, type AskHostOptions } from "./hosts/ask-host.js"
