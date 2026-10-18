/**
 * errdefer-style helpers: register cleanups, run them on failure (or always).
 */

export type Cleanup = () => void | Promise<void>

/**
 * Run `fn`. On throw, run cleanups in reverse (best-effort), then rethrow.
 * Like Zig `errdefer` for the whole block.
 */
export async function withErrDefer<T>(fn: (defer: (c: Cleanup) => void) => Promise<T>): Promise<T> {
  const stack: Cleanup[] = []
  const defer = (c: Cleanup) => {
    stack.push(c)
  }
  try {
    return await fn(defer)
  } catch (err) {
    for (let i = stack.length - 1; i >= 0; i--) {
      try {
        await stack[i]!()
      } catch {
        /* ignore cleanup errors */
      }
    }
    throw err
  }
}

/** Always run cleanups (success or failure), reverse order. Zig `defer`. */
export async function withDefer<T>(fn: (defer: (c: Cleanup) => void) => Promise<T>): Promise<T> {
  const stack: Cleanup[] = []
  const defer = (c: Cleanup) => {
    stack.push(c)
  }
  try {
    return await fn(defer)
  } finally {
    for (let i = stack.length - 1; i >= 0; i--) {
      try {
        await stack[i]!()
      } catch {
        /* ignore */
      }
    }
  }
}
