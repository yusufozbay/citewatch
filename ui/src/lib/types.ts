export type PromptSummary = {
  id: string
  keyword: string
  location_code: number
  language_code: string
  device: string
  source: string
  snapshots: number
  with_aio: number
  versions: number
  last_fetch: string | null
  briefs: number
  project: string
}

export type Project = {
  id: string
  name: string
  location_code: number | null
  language_code: string | null
  device: string | null
  brief_language: string | null
  brand: string | null
  own_brand: string | null
  prompts: number
}

export type SnapshotSummary = {
  id: number
  fetched_at: string
  has_aio: boolean
  text_hash: string
  reference_count: number
  cost: number | null
}

export type Reference = {
  url: string
  domain: string
  source: string
  title: string
  text: string
}

export type Snapshot = {
  id: number
  prompt_id: string
  keyword: string
  source: string
  fetched_at: string
  has_aio: boolean
  text: string
  text_hash: string
  references: Reference[]
  check_url: string | null
  cost: number | null
}

export type Brand = {
  name: string
  aliases: string[]
  domains: string[]
  own: boolean
  projects: string[]
  prompts: string[]
  /** Added from the UI rather than config.toml. */
  local?: boolean
}

export type SourceHistory = {
  snapshots: number
  domains: { domain: string; count: number }[]
  urls: { url: string; title: string; count: number }[]
}

export type Brief = {
  id: number
  prompt_id: string
  created_at: string
  window_from: string
  window_to: string
  snapshot_count: number
  model: string
  path: string
  markdown: string
  input_tokens: number | null
  output_tokens: number | null
}

export type OverviewPrompt = {
  id: string
  keyword: string
  snapshots: number
  latest_fetch: string | null
  /** Whether the most recent fetch showed an AI Overview. */
  has_aio: boolean
  /** Newest snapshot with an AI Overview: the one the prompt view opens by default. */
  latest_aio_snapshot_id: number | null
  latest_aio_fetch: string | null
  versions: number
  sources: number
  own_cited: boolean
}

export type ProjectOverview = {
  project: string
  prompts: OverviewPrompt[]
  snapshots: number
  aio_snapshots: number
  aio_rate: number | null
  prompts_with_aio: number
  own_domains: string[]
  own_cited_snapshots: number
  own_cited_prompts: number
  /** Share = AI Overview snapshots citing the domain / all AI Overview snapshots. */
  domains: { domain: string; count: number; share: number; own: boolean }[]
}

/** Answer of POST /api/prompts/{id}/fetch. */
export type FetchResult = {
  snapshot_id: number
  has_aio: boolean
  references: number
  cost: number
}

/** A "Run" click on a prompt: in flight, or how it ended. */
export type RunState = { running?: boolean; result?: FetchResult; error?: string }

/** A "Generate brief" click on a prompt: in flight, or how it ended. */
export type BriefRunState = { running?: boolean; briefId?: number; error?: string }
