import type { Brand, Reference } from "./types"

/** A source as it ranks inside one answer. */
export type RankedSource = Reference & {
  rank: number
  /** Number of inline citations pointing at this source. */
  citations: number
  /** False for references Google attached without citing them inline. */
  inline: boolean
}

export type PreparedAnswer = {
  /** Markdown with inline citations rewritten to `[rank](url "cite")`. */
  markdown: string
  sources: RankedSource[]
  /** Google's closing follow-up question ("Would you like…?"), shown separately. */
  followUp: string | null
}

// [[3]](https://example.com/page) – a URL may contain one level of balanced parentheses.
const CITATION = /\[\[(\d+)\]\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/g

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ""
    return u.toString().replace(/\/$/, "")
  } catch {
    return url
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function prepareAnswer(text: string, references: Reference[]): PreparedAnswer {
  const byUrl = new Map(references.map((r) => [normalizeUrl(r.url), r]))
  const order = new Map<string, RankedSource>()

  // Rank sources by where they are first cited in the answer.
  let markdown = text.replace(CITATION, (_m, _n, url: string) => {
    const key = normalizeUrl(url)
    let src = order.get(key)
    if (!src) {
      const ref = byUrl.get(key) ?? { url, domain: domainOf(url), source: "", title: "", text: "" }
      src = { ...ref, rank: order.size + 1, citations: 0, inline: true }
      order.set(key, src)
    }
    src.citations++
    return `[${src.rank}](${url} "cite")`
  })

  // References Google attached but never cited inline go last.
  for (const r of references) {
    const key = normalizeUrl(r.url)
    if (!order.has(key)) order.set(key, { ...r, rank: order.size + 1, citations: 0, inline: false })
  }

  markdown = markdown
    .replace(/\*\* +([.,;:!?])/g, "**$1") // "**bold** ." -> "**bold**."
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  let followUp: string | null = null
  const paras = markdown.split(/\n\n/)
  const last = paras[paras.length - 1]?.trim() ?? ""
  if (/^(would you like|do you want|should i|shall i)\b/i.test(last) && last.endsWith("?")) {
    followUp = last.replace(/\*\*/g, "")
    markdown = paras.slice(0, -1).join("\n\n").replace(/\n+-{3,}\s*$/, "").trim()
  }

  return { markdown, sources: [...order.values()], followUp }
}

/* ---------------------------------------------------------------- brands */

export type BrandMatch = { index: number; text: string; brand: Brand }

export type BrandMatcher = {
  /** All brand mentions in `text`, with indices into the original string. */
  find: (text: string) => BrandMatch[]
  active: boolean
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Case-fold for matching. Turkish dotted/dotless I are folded by hand: JavaScript lowercases "İ" to
 * "i" + a combining dot (two characters), so "İstanbul" would otherwise never match.
 * Every replacement keeps the string length, so indices in the folded text equal the original's.
 */
export const fold = (s: string) => s.replace(/[İIı]/g, "i").toLowerCase()

export function brandMatcher(brands: Brand[]): BrandMatcher {
  const lookup = new Map<string, Brand>()
  for (const b of brands) for (const term of [b.name, ...b.aliases]) if (term.trim()) lookup.set(fold(term.trim()), b)
  if (!lookup.size) return { find: () => [], active: false }
  // Longest terms first so "monday.com CRM" wins over "monday.com".
  const terms = [...lookup.keys()].sort((a, b) => b.length - a.length).map(escape)
  const regex = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.join("|")})(?![\\p{L}\\p{N}])`, "gu")
  return {
    active: true,
    find: (text) => {
      const out: BrandMatch[] = []
      for (const m of fold(text).matchAll(regex)) {
        const brand = lookup.get(m[1])
        if (brand) out.push({ index: m.index, text: text.slice(m.index, m.index + m[1].length), brand })
      }
      return out
    },
  }
}

/** Brands that apply to a prompt: global ones, the prompt's project or the prompt itself, then browser-only ones. */
export function brandsFor(config: Brand[], local: Brand[], prompt: { id: string; project: string } | undefined): Brand[] {
  const scoped = config.filter(
    (b) =>
      (!b.projects.length && !b.prompts.length) ||
      (prompt && (b.projects.includes(prompt.project) || b.prompts.includes(prompt.id))),
  )
  const names = new Set(scoped.map((b) => fold(b.name)))
  return [...scoped, ...local.filter((b) => !names.has(fold(b.name)))]
}

export type BrandStat = {
  brand: Brand
  mentions: number
  /** 1 = first brand mentioned in the answer. null when not mentioned. */
  position: number | null
  /** The brand's own domain appears among the sources. */
  cited: boolean
  /** Best (lowest) source rank among the brand's domains. */
  sourceRank: number | null
  context: string | null
}

/** Strip link targets and citation chips so URLs don't count as mentions. */
function plainText(markdown: string): string {
  return markdown
    .replace(/\[\d+\]\([^)]*\)/g, " ")
    .replace(/\]\((?:[^()]|\([^()]*\))*\)/g, "]")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "") // list markers
    .replace(/[[\]*_`#>|]/g, " ")
}

export function brandStats(markdown: string, brands: Brand[], sources: RankedSource[]): BrandStat[] {
  const text = plainText(markdown)
  const first = new Map<Brand, number>()
  const counts = new Map<Brand, number>()
  const context = new Map<Brand, string>()

  for (const { index, brand: b } of brandMatcher(brands).find(text)) {
    counts.set(b, (counts.get(b) ?? 0) + 1)
    if (!first.has(b)) {
      first.set(b, index)
      const start = text.lastIndexOf("\n", index) + 1
      const end = text.indexOf("\n", index)
      context.set(b, text.slice(start, end === -1 ? undefined : end).replace(/\s+/g, " ").trim())
    }
  }

  const positions = [...first.entries()].sort((a, b) => a[1] - b[1]).map(([b]) => b)
  return brands
    .map((brand) => {
      const own = sources.filter((s) =>
        brand.domains.some((d) => {
          const dom = domainOf(s.url)
          return dom === d.replace(/^www\./, "") || dom.endsWith("." + d.replace(/^www\./, ""))
        }),
      )
      const idx = positions.indexOf(brand)
      return {
        brand,
        mentions: counts.get(brand) ?? 0,
        position: idx === -1 ? null : idx + 1,
        cited: own.length > 0,
        sourceRank: own.length ? Math.min(...own.map((s) => s.rank)) : null,
        context: context.get(brand) ?? null,
      }
    })
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || Number(b.brand.own) - Number(a.brand.own))
}

/* ------------------------------------------------------- brand colours */

const PALETTE = ["violet", "sky", "amber", "emerald", "rose", "cyan", "orange", "lime", "fuchsia", "teal"] as const
export type Tone = (typeof PALETTE)[number] | "own"

export function brandTones(brands: Brand[]): Map<string, Tone> {
  const tones = new Map<string, Tone>()
  let i = 0
  for (const b of brands) tones.set(b.name, b.own ? "own" : PALETTE[i++ % PALETTE.length])
  return tones
}

// Literal class strings so Tailwind's scanner picks them up.
export const TONE_CLASSES: Record<Tone, { mark: string; dot: string }> = {
  own: { mark: "bg-primary text-primary-foreground ring-primary", dot: "bg-primary" },
  violet: { mark: "bg-violet-500/15 text-violet-800 ring-violet-500/30 dark:text-violet-200", dot: "bg-violet-500" },
  sky: { mark: "bg-sky-500/15 text-sky-800 ring-sky-500/30 dark:text-sky-200", dot: "bg-sky-500" },
  amber: { mark: "bg-amber-500/20 text-amber-900 ring-amber-500/30 dark:text-amber-200", dot: "bg-amber-500" },
  emerald: { mark: "bg-emerald-500/15 text-emerald-800 ring-emerald-500/30 dark:text-emerald-200", dot: "bg-emerald-500" },
  rose: { mark: "bg-rose-500/15 text-rose-800 ring-rose-500/30 dark:text-rose-200", dot: "bg-rose-500" },
  cyan: { mark: "bg-cyan-500/15 text-cyan-800 ring-cyan-500/30 dark:text-cyan-200", dot: "bg-cyan-500" },
  orange: { mark: "bg-orange-500/15 text-orange-800 ring-orange-500/30 dark:text-orange-200", dot: "bg-orange-500" },
  lime: { mark: "bg-lime-500/20 text-lime-900 ring-lime-500/30 dark:text-lime-200", dot: "bg-lime-500" },
  fuchsia: { mark: "bg-fuchsia-500/15 text-fuchsia-800 ring-fuchsia-500/30 dark:text-fuchsia-200", dot: "bg-fuchsia-500" },
  teal: { mark: "bg-teal-500/15 text-teal-800 ring-teal-500/30 dark:text-teal-200", dot: "bg-teal-500" },
}
