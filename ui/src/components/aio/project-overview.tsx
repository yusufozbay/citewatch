import { useEffect, useMemo, useState } from "react"
import { Check, LayoutDashboard } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { brandStats, brandTones, brandsFor, prepareAnswer, TONE_CLASSES, type BrandStat } from "@/lib/answer"
import { formatDate, locationName, timeAgo, useApi } from "@/lib/api"
import type { Brand, Project, ProjectOverview as Overview, PromptSummary, RunState, Snapshot } from "@/lib/types"
import { cn } from "@/lib/utils"

import { Favicon } from "./favicon"
import { RunPromptButton } from "./run-prompt-button"

type Props = {
  project: Project
  prompts: PromptSummary[]
  configBrands: Brand[]
  localBrands: Brand[]
  version: number
  onOpenPrompt: (id: string) => void
  runs: Record<string, RunState>
  onRun: (id: string) => void
}

/** Fetch several snapshots at once; keyed by snapshot id. */
function useSnapshots(ids: number[]) {
  const key = ids.join(",")
  const [data, setData] = useState<{ key: string; byId: Map<number, Snapshot> } | null>(null)
  useEffect(() => {
    if (!key) return
    let cancelled = false
    Promise.all(key.split(",").map((id) => fetch(`/api/snapshots/${id}`).then((r) => (r.ok ? (r.json() as Promise<Snapshot>) : null))))
      .then((list) => !cancelled && setData({ key, byId: new Map(list.filter((s) => s !== null).map((s) => [s.id, s])) }))
      .catch(() => !cancelled && setData({ key, byId: new Map() }))
    return () => {
      cancelled = true
    }
  }, [key])
  return !key ? new Map<number, Snapshot>() : data?.key === key ? data.byId : null
}

export function ProjectOverview({ project, prompts, configBrands, localBrands, version, onOpenPrompt, runs, onRun }: Props) {
  const overview = useApi<Overview>(`/api/projects/${encodeURIComponent(project.id)}/overview`, version)
  const rows = overview.data?.prompts ?? []
  const snaps = useSnapshots(rows.flatMap((r) => (r.latest_aio_snapshot_id ? [r.latest_aio_snapshot_id] : [])))

  // Brand stats per prompt, computed exactly like the prompt view's Brands panel (same brands, same snapshot).
  const perPrompt = useMemo(() => {
    const out = new Map<string, Map<string, BrandStat>>()
    if (!snaps) return out
    for (const r of rows) {
      const snap = r.latest_aio_snapshot_id ? snaps.get(r.latest_aio_snapshot_id) : undefined
      if (!snap?.has_aio) continue
      const prepared = prepareAnswer(snap.text, snap.references)
      const brands = brandsFor(configBrands, localBrands, prompts.find((p) => p.id === r.id))
      out.set(r.id, new Map(brandStats(prepared.markdown, brands, prepared.sources).map((s) => [s.brand.name, s])))
    }
    return out
  }, [rows, snaps, configBrands, localBrands, prompts])

  // Columns: every brand that applies to at least one prompt of the project, own brand first, then by visibility.
  const columns = useMemo(() => {
    const seen = new Map<string, Brand>()
    for (const p of prompts) for (const b of brandsFor(configBrands, localBrands, p)) if (!seen.has(b.name)) seen.set(b.name, b)
    const all = [...seen.values()]
    const tones = brandTones(all)
    const cols = all.map((brand) => {
      const hits = [...perPrompt.values()].map((m) => m.get(brand.name)).filter((s): s is BrandStat => !!s?.position)
      return {
        brand,
        tone: tones.get(brand.name) ?? "violet",
        mentioned: hits.length,
        avgPosition: hits.length ? hits.reduce((a, s) => a + (s.position ?? 0), 0) / hits.length : null,
      }
    })
    return cols.sort(
      (a, b) =>
        Number(b.brand.own) - Number(a.brand.own) ||
        b.mentioned - a.mentioned ||
        (a.avgPosition ?? 999) - (b.avgPosition ?? 999),
    )
  }, [prompts, configBrands, localBrands, perPrompt])

  const analysed = perPrompt.size
  const own = columns.find((c) => c.brand.own)
  const ov = overview.data
  const loadingBrands = !snaps && rows.some((r) => r.latest_aio_snapshot_id)
  const latest = rows.map((r) => r.latest_fetch).filter((d): d is string => !!d).sort().pop()

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="gap-1">
            <LayoutDashboard className="size-3" /> Overview
          </Badge>
          <Badge variant="outline">
            {locationName(project.location_code)}
            {project.language_code ? ` · ${project.language_code.toUpperCase()}` : ""}
          </Badge>
          {latest && <span>Updated {timeAgo(latest)}</span>}
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance">{project.name}</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length || prompts.length} prompt{(rows.length || prompts.length) === 1 ? "" : "s"} · brand positions from each prompt's latest AI
          Overview
        </p>
      </header>

      {overview.error && <p className="text-sm text-destructive">Couldn't load the overview ({overview.error})</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {own ? (
          <>
            <Kpi
              label={`${own.brand.name} visibility`}
              value={analysed ? `${Math.round((own.mentioned / analysed) * 100)}%` : "—"}
              hint={analysed ? `Mentioned in ${own.mentioned}/${analysed} prompts` : "No answers yet"}
              loading={loadingBrands}
            />
            <Kpi
              label={`${own.brand.name} avg. position`}
              value={own.avgPosition ? `#${own.avgPosition.toFixed(1).replace(/\.0$/, "")}` : "—"}
              hint={own.avgPosition ? "Among prompts that mention it" : "Not mentioned"}
              loading={loadingBrands}
            />
          </>
        ) : (
          <Kpi label="Own brand" value="—" hint="Set own = true on a brand in config.toml" />
        )}
        <Kpi
          label="Prompts with AI Overview"
          value={ov ? `${ov.prompts_with_aio}/${ov.prompts.length}` : "—"}
          hint={ov?.aio_rate != null ? `${Math.round(ov.aio_rate * 100)}% of ${ov.snapshots} fetches` : "No fetches yet"}
          loading={!ov}
        />
        {ov && ov.own_domains.length > 0 ? (
          <Kpi
            label="Own site cited"
            value={`${ov.own_cited_prompts}/${ov.prompts.length}`}
            hint={`In ${ov.own_cited_snapshots}/${ov.aio_snapshots} AI Overviews`}
          />
        ) : (
          <Kpi label="Brands tracked" value={columns.length} hint={`${columns.filter((c) => c.mentioned).length} mentioned somewhere`} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card size="sm" className="min-w-0">
          <CardHeader>
            <CardTitle>Brand positions by prompt</CardTitle>
            <CardDescription>Position = order of first mention in the latest AI Overview. Click a prompt to open it, or ▶ to fetch it now.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {!ov && <Skeleton className="mx-4 h-40" />}
            {ov && (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="sticky left-0 z-10 min-w-48 bg-card pl-4">Prompt</TableHead>
                    {columns.map((c) => (
                      <TableHead key={c.brand.name} className={cn("h-auto py-2 text-center align-bottom", c.brand.own && "bg-primary/5")}>
                        <span className="flex flex-col items-center gap-1">
                          <span className="flex items-center gap-1.5">
                            <span className={cn("size-2 rounded-full", TONE_CLASSES[c.tone].dot)} />
                            <span className={cn("text-xs", c.brand.own && "font-semibold")}>{c.brand.name}</span>
                          </span>
                          <span className="text-[11px] font-normal tabular-nums text-muted-foreground">
                            {analysed ? `${c.mentioned}/${analysed}` : "–"}
                          </span>
                        </span>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const stats = perPrompt.get(r.id)
                    return (
                      <TableRow key={r.id} onClick={() => onOpenPrompt(r.id)} className="group cursor-pointer">
                        <TableCell className="sticky left-0 z-10 max-w-64 bg-card pl-4 whitespace-normal group-hover:bg-muted">
                          <span className="flex items-start gap-2">
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-2 text-[13px] leading-snug font-medium">{r.keyword}</span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span className={cn("size-1.5 shrink-0 rounded-full", r.has_aio ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                                {r.latest_fetch ? formatDate(r.latest_fetch, { dateStyle: "medium" }) : "Not fetched yet"}
                                {r.latest_aio_snapshot_id && (
                                  <>
                                    {" "}· {r.versions} version{r.versions === 1 ? "" : "s"} · {r.sources} sources
                                  </>
                                )}
                              </span>
                              {runs[r.id]?.error && (
                                <span title={runs[r.id]?.error} className="mt-0.5 block truncate text-[11px] text-destructive">
                                  Run failed: {runs[r.id]?.error}
                                </span>
                              )}
                            </span>
                            <RunPromptButton compact run={runs[r.id]} onRun={() => onRun(r.id)} className="shrink-0" />
                          </span>
                        </TableCell>
                        {columns.map((c) => {
                          const s = stats?.get(c.brand.name)
                          return (
                            <TableCell key={c.brand.name} className={cn("text-center", c.brand.own && "bg-primary/5")}>
                              {loadingBrands ? (
                                <Skeleton className="mx-auto size-6" />
                              ) : s?.position ? (
                                <span
                                  title={`${s.mentions}× mentioned${s.cited ? " · own site cited" : ""}`}
                                  className={cn(
                                    "inline-flex size-6 items-center justify-center rounded-md text-xs font-semibold tabular-nums ring-1 ring-inset",
                                    TONE_CLASSES[c.tone].mark,
                                  )}
                                >
                                  {s.position}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/60">–</span>
                              )}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Top cited domains {ov && <Badge variant="secondary">{ov.aio_snapshots} AI Overviews</Badge>}
            </CardTitle>
            <CardDescription>Share of the project's AI Overview snapshots citing each domain</CardDescription>
          </CardHeader>
          <CardContent className="px-2">
            {ov && ov.domains.length === 0 && <p className="px-2 text-sm text-muted-foreground">No AI Overview sources stored yet.</p>}
            <ol className="space-y-0.5">
              {ov?.domains.map((d, i) => (
                <li key={d.domain} className={cn("flex items-center gap-3 rounded-lg px-2 py-2", d.own && "bg-primary/5")}>
                  <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <Favicon domain={d.domain} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium">{d.domain}</span>
                      {d.own && <Badge className="h-4 px-1.5 text-[10px]">You</Badge>}
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                        {Math.round(d.share * 100)}% · {d.count}/{ov.aio_snapshots}
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", d.own ? "bg-primary" : "bg-foreground/70")} style={{ width: `${d.share * 100}%` }} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {ov && ov.own_domains.length > 0 && (
              <p className="mt-2 flex items-center gap-1 px-2 text-[11px] text-muted-foreground">
                {ov.own_cited_snapshots > 0 && <Check className="size-3 text-emerald-600" />}
                {ov.own_domains.join(", ")} cited in {ov.own_cited_snapshots}/{ov.aio_snapshots} AI Overviews
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Kpi({ label, value, hint, loading }: { label: string; value: string | number; hint?: string; loading?: boolean }) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-16" />
      ) : (
        <p className="mt-1 truncate font-heading text-xl font-semibold tabular-nums">{value}</p>
      )}
      {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
