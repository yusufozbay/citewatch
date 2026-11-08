import { createContext, memo, useContext, useMemo, type ComponentProps } from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { ExternalLink } from "lucide-react"

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { brandMatcher, domainOf, TONE_CLASSES, type RankedSource, type Tone } from "@/lib/answer"
import { rehypeBrands } from "@/lib/rehype-brands"
import type { Brand } from "@/lib/types"
import { cn } from "@/lib/utils"

import { Favicon } from "./favicon"

type Props = {
  markdown: string
  sources?: RankedSource[]
  brands?: Brand[]
  tones?: Map<string, Tone>
  activeRank?: number | null
  activeBrand?: string | null
  onRankHover?: (rank: number | null) => void
  className?: string
}

type Ctx = {
  byRank: Map<number, RankedSource>
  tones: Map<string, Tone>
  activeRank: number | null
  activeBrand: string | null
  onRankHover?: (rank: number | null) => void
}

// Hover state flows through context so the markdown components below keep a stable identity;
// recreating them per render would remount every citation chip and close its hover card.
const AnswerCtx = createContext<Ctx>({ byRank: new Map(), tones: new Map(), activeRank: null, activeBrand: null })
const NO_SOURCES: RankedSource[] = []
const NO_BRANDS: Brand[] = []
const NO_TONES = new Map<string, Tone>()

/** Renders AI answer markdown with citation chips and highlighted brand mentions. */
export function AnswerMarkdown({
  markdown,
  sources = NO_SOURCES,
  brands = NO_BRANDS,
  tones = NO_TONES,
  activeRank = null,
  activeBrand = null,
  onRankHover,
  className,
}: Props) {
  const byRank = useMemo(() => new Map(sources.map((s) => [s.rank, s])), [sources])
  const ctx = useMemo(
    () => ({ byRank, tones, activeRank, activeBrand, onRankHover }),
    [byRank, tones, activeRank, activeBrand, onRankHover],
  )

  return (
    <AnswerCtx.Provider value={ctx}>
      <div
        className={cn(
          "prose prose-neutral max-w-none text-[15px] leading-7 dark:prose-invert",
          "prose-headings:font-heading prose-headings:font-semibold prose-headings:tracking-tight",
          "prose-h3:mt-8 prose-h3:mb-3 prose-h3:text-base",
          "prose-p:my-3 prose-li:my-1.5 prose-ul:my-3 prose-ul:pl-5 prose-li:marker:text-muted-foreground",
          "prose-strong:font-semibold prose-strong:text-foreground prose-hr:my-6 prose-hr:border-border",
          "prose-a:text-foreground prose-a:no-underline",
          "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
          className,
        )}
      >
        <RenderedMarkdown markdown={markdown} brands={brands} />
      </div>
    </AnswerCtx.Provider>
  )
}

/** Parsing is memoised on the text and brand list, so hover changes don't re-parse the markdown. */
const RenderedMarkdown = memo(function RenderedMarkdown({ markdown, brands }: { markdown: string; brands: Brand[] }) {
  const matcher = useMemo(() => brandMatcher(brands), [brands])
  const rehypePlugins = useMemo(() => [[rehypeBrands, matcher] as [typeof rehypeBrands, typeof matcher]], [matcher])
  return (
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={COMPONENTS}>
      {markdown}
    </Markdown>
  )
})

const COMPONENTS: Components = {
  a: ({ href, title, children }) =>
    title === "cite" ? (
      <Citation rank={Number(String(children))} href={href ?? ""} />
    ) : (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-medium underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:decoration-foreground"
      >
        {children}
      </a>
    ),
  mark: (props: ComponentProps<"mark"> & { "data-brand"?: string }) => <BrandMark name={props["data-brand"]}>{props.children}</BrandMark>,
  // AI Overviews wrap emphasised phrases in backticks; only short tokens (e.g. `@firma.com`) read as code.
  code: ({ children, className }) =>
    !className && /\s/.test(String(children)) ? (
      <span className="font-medium text-foreground">{children}</span>
    ) : (
      <code className={className}>{children}</code>
    ),
  table: ({ children }) => (
    <div className="not-prose my-5 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm [&_td]:border-t [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_th]:bg-muted/60 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted-foreground [&_td:first-child]:font-medium">
        {children}
      </table>
    </div>
  ),
}

function BrandMark({ name, children }: { name?: string; children: React.ReactNode }) {
  const { tones, activeBrand } = useContext(AnswerCtx)
  const tone = (name && tones.get(name)) || "violet"
  return (
    <mark
      data-brand={name}
      className={cn(
        "rounded-[4px] px-[3px] py-0.5 font-medium ring-1 ring-inset transition-opacity box-decoration-clone",
        TONE_CLASSES[tone].mark,
        activeBrand && activeBrand !== name && "opacity-35",
        activeBrand === name && "ring-2",
      )}
    >
      {children}
    </mark>
  )
}

function Citation({ rank, href }: { rank: number; href: string }) {
  const { byRank, activeRank, onRankHover } = useContext(AnswerCtx)
  const source = byRank.get(rank)
  const domain = source?.domain || domainOf(href)
  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          onMouseEnter={() => onRankHover?.(rank)}
          onMouseLeave={() => onRankHover?.(null)}
          className={cn(
            "not-prose relative -top-px ml-1 inline-flex h-[18px] items-center gap-1 rounded-full border bg-background pr-1.5 pl-0.5 align-middle text-[10.5px] leading-none font-medium text-muted-foreground no-underline transition-colors hover:border-foreground/30 hover:text-foreground",
            activeRank === rank && "border-primary bg-primary text-primary-foreground hover:text-primary-foreground",
          )}
        >
          <Favicon domain={domain} className="size-3.5 rounded-full" />
          {rank}
        </a>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Favicon domain={domain} />
          <span className="truncate">{domain.replace(/^www\./, "")}</span>
          <span className="ml-auto shrink-0 tabular-nums">Source #{rank}</span>
        </div>
        <p className="mt-2 line-clamp-2 text-sm leading-snug font-medium">{source?.title || href}</p>
        {source?.text && <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{source.text}</p>}
        <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>Cited {source?.citations ?? 1}× in this answer</span>
          <ExternalLink className="size-3.5" />
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
