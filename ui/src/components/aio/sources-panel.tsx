import { ArrowUpRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { RankedSource } from "@/lib/answer"
import type { SourceHistory } from "@/lib/types"
import { cn } from "@/lib/utils"

import { Favicon } from "./favicon"

type Props = {
  sources: RankedSource[]
  history?: SourceHistory | null
  activeRank: number | null
  onRankHover: (rank: number | null) => void
}

export function SourcesPanel({ sources, history, activeRank, onRankHover }: Props) {
  const inline = sources.filter((s) => s.inline)
  const attached = sources.filter((s) => !s.inline)
  const seen = new Map(history?.urls.map((u) => [u.url, u.count]))
  const total = history?.snapshots ?? 0
  const maxCites = Math.max(1, ...inline.map((s) => s.citations))

  const row = (s: RankedSource) => (
    <li key={s.url}>
      <a
        href={s.url}
        target="_blank"
        rel="noreferrer"
        onMouseEnter={() => onRankHover(s.rank)}
        onMouseLeave={() => onRankHover(null)}
        className={cn(
          "group flex gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/70",
          activeRank === s.rank && "bg-muted",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold tabular-nums",
            s.rank <= 3 && s.inline && "border-transparent bg-primary text-primary-foreground",
            activeRank === s.rank && "border-transparent bg-primary text-primary-foreground",
          )}
        >
          {s.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Favicon domain={s.domain} className="size-3.5" />
            <span className="truncate">{s.domain.replace(/^www\./, "")}</span>
            <ArrowUpRight className="ml-auto size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug font-medium">{s.title || s.url}</p>
          {s.inline && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-foreground/70" style={{ width: `${(s.citations / maxCites) * 100}%` }} />
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{s.citations}× cited</span>
              {total > 1 && (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  · {seen.get(s.url) ?? 0}/{total} days
                </span>
              )}
            </div>
          )}
        </div>
      </a>
    </li>
  )

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Sources <Badge variant="secondary">{sources.length}</Badge>
        </CardTitle>
        <CardDescription>Ranked by first citation in the answer</CardDescription>
      </CardHeader>
      <CardContent className="px-2">
        <ol className="space-y-0.5">{inline.map(row)}</ol>
        {attached.length > 0 && (
          <>
            <p className="mt-3 px-2 pb-1 text-xs font-medium text-muted-foreground">Attached, not cited inline</p>
            <ol className="space-y-0.5">{attached.map(row)}</ol>
          </>
        )}
      </CardContent>
    </Card>
  )
}
