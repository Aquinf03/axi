/** Provider catalog — data only. Transport / keys live in gateway. */

export type ProviderId = "openai" | "anthropic" | "grok" | "ollama"

export type ProviderKind = "openai" | "anthropic"

export type ProviderEntry = {
  id: ProviderId
  aliases: string[]
  title: string
  kind: ProviderKind
  base: string
  env: string[]
  model: string
  models: string[]
  needsKey: boolean
  window: number
}

export const PROVIDER_CATALOG: ProviderEntry[] = [
  {
    id: "openai",
    aliases: ["oai"],
    title: "OpenAI",
    kind: "openai",
    base: "https://api.openai.com/v1",
    env: ["OPENAI_API_KEY"],
    model: "gpt-5.6",
    models: ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
    needsKey: true,
    window: 1_000_000,
  },
  {
    id: "anthropic",
    aliases: ["claude"],
    title: "Anthropic",
    kind: "anthropic",
    base: "https://api.anthropic.com",
    env: ["ANTHROPIC_API_KEY"],
    model: "claude-sonnet-5",
    models: ["claude-sonnet-5", "claude-opus-5", "claude-fable-5", "claude-haiku-4-5"],
    needsKey: true,
    window: 1_000_000,
  },
  {
    id: "grok",
    aliases: ["xai", "x"],
    title: "Grok (xAI)",
    kind: "openai",
    base: "https://api.x.ai/v1",
    env: ["XAI_API_KEY", "GROK_API_KEY"],
    model: "grok-4.6",
    models: ["grok-4.6", "grok-4.5", "grok-4.3", "grok-build-0.1"],
    needsKey: true,
    window: 500_000,
  },
  {
    id: "ollama",
    aliases: ["local"],
    title: "Ollama",
    kind: "openai",
    base: "http://127.0.0.1:11434/v1",
    env: [],
    model: "qwen3",
    models: ["qwen3", "qwen3.8", "llama4", "gemma4", "deepseek-r1", "gpt-oss"],
    needsKey: false,
    window: 32_768,
  },
]
