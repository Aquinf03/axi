import { addUsage, emptyUsage, type TokenUsage } from "./types.js"
import { formatUsageBlock, formatUsageLine } from "./format.js"

/** Session-scoped accumulator for chat (or one-shot ask). */
export type UsageMeter = {
  /** Last completed user→assistant turn (all model rounds in that turn). */
  readonly turn: TokenUsage
  /** Sum across the whole chat / ask. */
  readonly chat: TokenUsage
  record(piece: Partial<TokenUsage> | null | undefined): void
  beginTurn(): void
  endTurn(): TokenUsage
  line(model: string, scope: "turn" | "chat"): string
  block(model: string, scope: "turn" | "chat"): string
  reset(): void
}

export function createUsageMeter(): UsageMeter {
  let turn = emptyUsage()
  let chat = emptyUsage()
  let turnOpen = emptyUsage()

  return {
    get turn() {
      return { ...turn }
    },
    get chat() {
      return { ...chat }
    },
    record(piece) {
      turnOpen = addUsage(turnOpen, piece)
    },
    beginTurn() {
      turnOpen = emptyUsage()
    },
    endTurn() {
      turn = turnOpen
      chat = addUsage(chat, turn)
      turnOpen = emptyUsage()
      return { ...turn }
    },
    line(model, scope) {
      return formatUsageLine(scope === "turn" ? turn : chat, model, scope)
    },
    block(model, scope) {
      return formatUsageBlock(scope === "turn" ? turn : chat, model, scope)
    },
    reset() {
      turn = emptyUsage()
      chat = emptyUsage()
      turnOpen = emptyUsage()
    },
  }
}
