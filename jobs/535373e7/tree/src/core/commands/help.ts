/** Help text from the CLI spec table (same snapshot as --json help). */

import { HelpSnapshot } from "../output.js"

export function help(): string {
  return new HelpSnapshot().toText()
}
