/**
 * Front door for skills + MCP runtime.
 * Outside code imports this file only — not `skills/*.ts` internals (except tests).
 */

export type { McpSpec, McpToolInfo } from "./skills/mcp.js"
export { McpClient, startMcp } from "./skills/mcp.js"
export type { Skill } from "./skills/skill.js"
export {
  listSkills,
  loadSkill,
  searchSkills,
  skillBlurb,
  skillsDigest,
} from "./skills/skill.js"
export type { ExtraTool } from "./skills/skill-runtime.js"
export {
  activateSkill,
  callMcpTool,
  extraTools,
  mcpToolName,
  runSkillCode,
  shutdownSkills,
} from "./skills/skill-runtime.js"
