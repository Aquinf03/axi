/**
 * Front door for turn hosts (ask today; TTY chat builds its host in ui/).
 * Agent core stays in agent-loop; hosts only supply I/O.
 */

export { createAskHost, type AskHostOptions } from "./hosts/ask-host.js"
