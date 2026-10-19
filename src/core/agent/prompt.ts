/** Assemble the agent system prompt from builtins data. */

import {
  BASE_PROMPT,
  PROJECT_SPECIALTY,
  TRAIN_SPECIALTY,
} from "../../builtins/system_prompt.js"
import { isTrain } from "../schema.js"

export type PromptBits = {
  extra?: string
  objective?: string
  progress?: string
  /** Stance posture block (explore / execute / challenge). */
  stance?: string
  /** Investigation graph overview (hypotheses ↔ evidence). */
  investigate?: string
  /** Belief-revision gate (open contradictions). */
  belief?: string
  /** Judgment labels on recent pivots (intervention taxonomy). */
  judgment?: string
}

export function systemPrompt(train: string, extraOrBits: string | PromptBits = ""): string {
  const bits: PromptBits = typeof extraOrBits === "string" ? { extra: extraOrBits } : extraOrBits
  const specialty = isTrain(train) ? TRAIN_SPECIALTY : PROJECT_SPECIALTY
  const lines = [
    ...BASE_PROMPT,
    ...specialty,
    bits.stance?.trim() ?? "",
    bits.investigate?.trim() ?? "",
    bits.belief?.trim() ?? "",
    bits.judgment?.trim() ?? "",
    bits.objective ? `Current request:\n${bits.objective}` : "",
    bits.progress ? `This turn so far (do not forget; do not redo):\n${bits.progress}` : "",
    bits.extra?.trim() ?? "",
  ]
  return lines.filter(Boolean).join("\n")
}
