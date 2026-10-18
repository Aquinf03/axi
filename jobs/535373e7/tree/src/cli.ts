#!/usr/bin/env node
/** axi CLI — composition root. Leaf logic lives in core/commands. */

import { dispatchCli } from "./core/commands/dispatch.js"

dispatchCli(process.argv.slice(2)).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(msg)
  process.exitCode = 1
})
