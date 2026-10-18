/** Disk layout for codemode mode: ~/.axi/codemode/ */

import path from "node:path"
import { axiHome } from "../home.js"
import { CODEMODE_DIR_NAME, CODEMODE_MODE_FILE } from "./types.js"

export function globalCodemodeDir(): string {
  return path.join(axiHome(), CODEMODE_DIR_NAME)
}

export function globalCodemodeModePath(): string {
  return path.join(globalCodemodeDir(), CODEMODE_MODE_FILE)
}
