import { useEffect, useMemo, useRef, useState } from "react"
import { ExternalLink, FolderOpen, KeyRound, Loader2, Globe, Languages, LayoutDashboard, MessageCircleQuestion, Monitor, Moon, Plus, Search, Smartphone, Sparkles, Sun, Trash2, X } from "lucide-react"

import { AddPromptDialog } from "@/components/aio/add-prompt-dialog"
import { AnswerMarkdown } from "@/components/aio/answer-markdown"
import { BrandsPanel } from "@/components/aio/brands-panel"
import { BriefTab } from "@/components/aio/brief-tab"
import { DeletePromptDialog, type DeleteResult } from "@/components/aio/delete-prompt-dialog"
import { HistoryTab } from "@/components/aio/history-tab"
import { MovePromptMenu } from "@/components/aio/move-prompt-menu"
import { NewProjectDialog } from "@/components/aio/new-project-dialog"
import { ProjectOverview } from "@/components/aio/project-overview"
import { ProjectSwitcher } from "@/components/aio/project-switcher"
import { SettingsDialog, keysMissing, type KeyStatus } from "@/components/aio/settings-dialog"
import { RunPromptButton, RunStatus } from "@/components/aio/run-prompt-button"
import { SnapshotTimeline } from "@/components/aio/snapshot-timeline"
import { SourcesPanel } from "@/components/aio/sources-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { brandStats, brandTones, brandsFor, prepareAnswer } from "@/lib/answer"
import { formatDate, locationName, sendJson, timeAgo, useApi } from "@/lib/api"
import type { Brand, Brief, BriefRunState, FetchResult, Project, PromptSummary, RunState, Snapshot, SnapshotSummary, SourceHistory } from "@/lib/types"
import { cn } from "@/lib/utils"

const LOCAL_BRANDS_KEY = "aio.localBrands"
/** Stands in for a prompt id in the selection and the URL (#project/overview). */
const OVERVIEW = "overview"

function readLocalBrands(): Brand[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_BRANDS_KEY) ?? "[]")
  } catch {
    return []
  }
}

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("aio.theme")
      return saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches
    } catch {
      return false
    }
  })
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    try {
      localStorage.setItem("aio.theme", dark ? "dark" : "light")
    } catch {
      /* private mode */
    }
  }, [dark])
  return [dark, setDark] as const
}

export default function App() {
  const [dark, setDark] = useTheme()
  // Bumped after any change so the project, prompt and brand lists refetch.
  const [version, setVersion] = useState(0)
  const [deleted, setDeleted] = useState<DeleteResult | null>(null)
  const projects = useApi<Project[]>("/api/projects", version)
  const prompts = useApi<PromptSummary[]>("/api/prompts", version)
  const configBrands = useApi<Brand[]>("/api/brands", version)
  // The selection lives in the URL hash (#project/prompt, or #project/overview) so reloads and shared links keep it.
  const [projectId, setProjectId] = useState<string | null>(() => parseHash().project)
  const [promptId, setPromptId] = useState<string | null>(() => parseHash().prompt)
  // Set after a change; selection repair waits until the refetched lists include it.
  const pending = useRef<{ project?: string; prompt?: string } | null>(null)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [addPromptOpen, setAddPromptOpen] = useState(false)
  const [keysVersion, setKeysVersion] = useState(0)
  const keys = useApi<KeyStatus>("/api/settings/keys", keysVersion)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const missingKeys = keys.data ? keysMissing(keys.data) : false
  // First run: open "Connect your APIs" once on load when a required key isn't set, unless there is
  // already data to look at (the sample project works without keys).
  const askedForKeys = useRef(false)
  useEffect(() => {
    if (keys.data && prompts.data && !askedForKeys.current) {
      askedForKeys.current = true
      if (keysMissing(keys.data) && !prompts.data.some((p) => p.snapshots > 0)) setSettingsOpen(true)
    }
  }, [keys.data, prompts.data])
  const [snapId, setSnapId] = useState<number | null>(null)
  const [query, setQuery] = useState("")
  const [localBrands, setLocalBrands] = useState<Brand[]>(readLocalBrands)
  const [activeRank, setActiveRank] = useState<number | null>(null)
  const [activeBrand, setActiveBrand] = useState<string | null>(null)

  // Keep project and prompt consistent: a prompt must belong to the selected project.
  useEffect(() => {
    const ps = prompts.data
    const pj = projects.data
    if (!ps || !pj) return
    const want = pending.current
    if (want) {
      const fresh =
        (!want.project || pj.some((p) => p.id === want.project)) &&
        (!want.prompt || ps.some((p) => p.id === want.prompt && (!want.project || p.project === want.project)))
      if (!fresh) return
      pending.current = null
    }
    const current = ps.find((p) => p.id === promptId)
    const proj = pj.some((p) => p.id === projectId)
      ? projectId
      : (current?.project ?? (pj.some((p) => p.id === promptId) ? promptId : (pj[0]?.id ?? null)))
    if (proj !== projectId) setProjectId(proj)
    if (promptId !== OVERVIEW && (!current || current.project !== proj)) {
      const first = ps.find((p) => p.project === proj)?.id ?? null
      if (first !== promptId) setPromptId(first)
    }
  }, [prompts.data, projects.data, projectId, promptId])
  useEffect(() => {
    if (projectId)
      window.history.replaceState(null, "", `#${encodeURIComponent(projectId)}${promptId ? `/${encodeURIComponent(promptId)}` : ""}`)
  }, [projectId, promptId])
  useEffect(() => {
    const onHash = () => {
      const h = parseHash()
      setProjectId(h.project)
      setPromptId(h.prompt)
    }
    addEventListener("hashchange", onHash)
    return () => removeEventListener("hashchange", onHash)
  }, [])

  const refresh = (select?: { project?: string; prompt?: string }) => {
    if (select) {
      pending.current = select
      if (select.project) setProjectId(select.project)
      if (select.prompt !== undefined) setPromptId(select.prompt)
    }
    setVersion((v) => v + 1)
  }

  const showOverview = promptId === OVERVIEW
  const promptKey = showOverview ? null : promptId
  const snapshots = useApi<SnapshotSummary[]>(promptKey && `/api/prompts/${promptKey}/snapshots`, version)
  const sourceHistory = useApi<SourceHistory>(promptKey && `/api/prompts/${promptKey}/sources`, version)
  const briefs = useApi<Brief[]>(promptKey && `/api/prompts/${promptKey}/briefs`, version)

  // "Run" clicks per prompt id. A finished run on the open prompt jumps the timeline to the new snapshot.
  const [runs, setRuns] = useState<Record<string, RunState>>({})
  const openPrompt = useRef(promptId)
  openPrompt.current = promptId
  const wantSnap = useRef<number | null>(null)
  useEffect(() => {
    wantSnap.current = null
  }, [promptId])
  const [briefRuns, setBriefRuns] = useState<Record<string, BriefRunState>>({})
  const runBrief = async (id: string) => {
    setBriefRuns((r) => ({ ...r, [id]: { running: true } }))
    try {
      const { brief_id } = await sendJson<{ brief_id: number }>(`/api/prompts/${encodeURIComponent(id)}/brief`, "POST", {})
      setBriefRuns((r) => ({ ...r, [id]: { briefId: brief_id } }))
      setVersion((v) => v + 1)
    } catch (e) {
      setBriefRuns((r) => ({ ...r, [id]: { error: (e as Error).message } }))
    }
  }
  const runPrompt = async (id: string) => {
    setRuns((r) => ({ ...r, [id]: { running: true } }))
    try {
      const result = await sendJson<FetchResult>(`/api/prompts/${encodeURIComponent(id)}/fetch`, "POST", {})
      setRuns((r) => ({ ...r, [id]: { result } }))
      if (openPrompt.current === id) wantSnap.current = result.snapshot_id
      setVersion((v) => v + 1)
    } catch (e) {
      setRuns((r) => ({ ...r, [id]: { error: (e as Error).message } }))
    }
  }

  useEffect(() => {
    const list = snapshots.data
    if (!list) return
    const want = wantSnap.current
    if (want !== null) {
      if (!list.some((s) => s.id === want)) return // the refetched list hasn't arrived yet
      wantSnap.current = null
      if (want !== snapId) return setSnapId(want)
    }
    if (!list.some((s) => s.id === snapId)) setSnapId(list.find((s) => s.has_aio)?.id ?? list[0]?.id ?? null)
  }, [snapshots.data, snapId])

  const snapshot = useApi<Snapshot>(snapId ? `/api/snapshots/${snapId}` : null)
  const prompt = showOverview ? undefined : prompts.data?.find((p) => p.id === promptId)
  const project = projects.data?.find((p) => p.id === projectId)

  const brands = useMemo(() => brandsFor(configBrands.data ?? [], localBrands, prompt), [configBrands.data, localBrands, prompt])
  const tones = useMemo(() => brandTones(brands), [brands])

  const prepared = useMemo(
    () => (snapshot.data?.has_aio ? prepareAnswer(snapshot.data.text, snapshot.data.references) : null),
    [snapshot.data],
  )
  const stats = useMemo(() => (prepared ? brandStats(prepared.markdown, brands, prepared.sources) : []), [prepared, brands])

  const saveLocal = (next: Brand[]) => {
    setLocalBrands(next)
    try {
      localStorage.setItem(LOCAL_BRANDS_KEY, JSON.stringify(next))
    } catch {
      /* private mode */
    }
  }

  const inProject = prompts.data?.filter((p) => p.project === projectId) ?? []
  const filtered = inProject.filter((p) => p.keyword.toLowerCase().includes(query.toLowerCase()))
  const words = prepared ? prepared.markdown.replace(/\[\d+\]\([^)]*\)/g, "").split(/\s+/).filter(Boolean).length : 0
  const own = stats.find((s) => s.brand.own)
  const top = stats.find((s) => s.position === 1)

  return (
    <div className="min-h-svh bg-muted/40 lg:grid lg:grid-cols-[288px_1fr]">
      {/* ---------------------------------------------------------- sidebar */}
      <aside className="border-b bg-background lg:sticky lg:top-0 lg:h-svh lg:border-r lg:border-b-0">
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2.5 px-4 py-4">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold">CiteWatch</p>
              <p className="text-xs text-muted-foreground">AI Overview visibility</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="relative ml-auto size-8"
              onClick={() => setSettingsOpen(true)}
              aria-label="API keys"
              title={missingKeys ? "API keys: some are missing" : "API keys"}
            >
              <KeyRound />
              {missingKeys && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive" />}
            </Button>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => setDark(!dark)} aria-label="Toggle theme">
              {dark ? <Sun /> : <Moon />}
            </Button>
          </div>
          <div className="px-3 pb-3">
            <ProjectSwitcher
              projects={projects.data ?? []}
              current={project}
              onSelect={(id) => {
                setProjectId(id)
                setQuery("")
              }}
              onNew={() => setNewProjectOpen(true)}
            />
          </div>
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search prompts" className="h-8 pl-8" />
            </div>
          </div>
          <div className="flex items-center px-4 pt-2 pb-1">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Prompts · {inProject.length}</p>
            {project && (
              <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={() => setAddPromptOpen(true)} aria-label="Add prompt">
                <Plus />
              </Button>
            )}
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-1 lg:flex-col lg:overflow-y-auto">
            {prompts.loading && !prompts.data && [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            {project && inProject.length > 0 && (
              <button
                onClick={() => setPromptId(OVERVIEW)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted lg:shrink",
                  showOverview && "bg-muted",
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background">
                  <LayoutDashboard className="size-3.5" />
                </span>
                <span className="leading-tight">
                  <span className="block text-[13px] font-medium">Overview</span>
                  <span className="block text-[11px] text-muted-foreground">All {inProject.length} prompts</span>
                </span>
              </button>
            )}
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => setPromptId(p.id)}
                className={cn(
                  "min-w-56 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted lg:min-w-0",
                  p.id === promptId && "bg-muted",
                )}
              >
                <p className="line-clamp-2 text-[13px] leading-snug font-medium">{p.keyword}</p>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {runs[p.id]?.running ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <span className={cn("size-1.5 rounded-full", p.with_aio ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                  )}
                  {runs[p.id]?.running ? "Running · " : ""}
                  {p.snapshots} snapshot{p.snapshots === 1 ? "" : "s"} · {p.versions} version{p.versions === 1 ? "" : "s"}
                </p>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* ------------------------------------------------------------- main */}
      <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        {prompts.error && <ErrorNote message={prompts.error} />}
        {deleted && (
          <div className="mx-auto mb-5 flex max-w-[1280px] items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
            <Trash2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="flex-1">
              Deleted <span className="font-medium">“{deleted.keyword}”</span>: {deleted.snapshots_deleted} snapshot
              {deleted.snapshots_deleted === 1 ? "" : "s"}, {deleted.briefs_deleted} brief{deleted.briefs_deleted === 1 ? "" : "s"}
              {deleted.brands_removed.length > 0 && <> and brand{deleted.brands_removed.length === 1 ? "" : "s"} {deleted.brands_removed.join(", ")}</>}
              . <span className="text-muted-foreground">config.toml was backed up to config.toml.bak.</span>
            </p>
            <Button variant="ghost" size="icon-xs" onClick={() => setDeleted(null)} aria-label="Dismiss">
              <X />
            </Button>
          </div>
        )}
        {project && showOverview && inProject.length > 0 && (
          <ProjectOverview
            project={project}
            prompts={inProject}
            configBrands={configBrands.data ?? []}
            localBrands={localBrands}
            version={version}
            onOpenPrompt={setPromptId}
            runs={runs}
            onRun={runPrompt}
          />
        )}
        {project && !prompt && prompts.data && (!showOverview || inProject.length === 0) && (
          <div className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-14 text-center">
            <FolderOpen className="size-8 text-muted-foreground/60" />
            <p className="font-medium">{project.name} has no prompts yet</p>
            <p className="text-sm text-muted-foreground">
              Add the searches you want to watch. Each one is fetched in {locationName(project.location_code)}
              {project.language_code ? ` (${project.language_code.toUpperCase()})` : ""} every day.
            </p>
            <Button onClick={() => setAddPromptOpen(true)}>
              <Plus /> Add prompt
            </Button>
          </div>
        )}
        {prompt && (
          <div className="mx-auto max-w-[1280px] space-y-5">
            <header className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {project && (
                  <Badge variant="secondary" className="gap-1">
                    <FolderOpen className="size-3" /> {project.name}
                  </Badge>
                )}
                <Badge variant="outline" className="gap-1">
                  <Sparkles className="size-3" /> {prompt.source === "google_ai_mode" ? "Google AI Mode" : "Google AI Overview"}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Globe className="size-3" /> {locationName(prompt.location_code)}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Languages className="size-3" /> {prompt.language_code.toUpperCase()}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  {prompt.device === "mobile" ? <Smartphone className="size-3" /> : <Monitor className="size-3" />} {prompt.device}
                </Badge>
                {prompt.last_fetch && <span>Updated {timeAgo(prompt.last_fetch)}</span>}
              </div>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance">“{prompt.keyword}”</h1>
                <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1">
                <RunPromptButton run={runs[prompt.id]} onRun={() => runPrompt(prompt.id)} />
                <MovePromptMenu
                  prompt={prompt}
                  projects={projects.data ?? []}
                  onMoved={(target) => refresh({ project: target, prompt: prompt.id })}
                />
                <DeletePromptDialog
                  prompt={prompt}
                  onDeleted={(result) => {
                    setDeleted(result)
                    setPromptId(null)
                    setVersion((v) => v + 1)
                  }}
                />
                </div>
                <RunStatus run={runs[prompt.id]} />
                </div>
              </div>
              {snapshots.data && snapshots.data.length > 0 && (
                <SnapshotTimeline snapshots={snapshots.data} selected={snapId} onSelect={setSnapId} />
              )}
            </header>

            <Tabs defaultValue="answer">
              <TabsList>
                <TabsTrigger value="answer">Answer</TabsTrigger>
                <TabsTrigger value="history">Source history</TabsTrigger>
                <TabsTrigger value="brief">
                  Brief {prompt.briefs > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1.5">{prompt.briefs}</Badge>}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="answer" className="mt-4 space-y-4">
                {snapshots.data?.length === 0 && (
                  <EmptyNote>
                    No snapshots yet. The first AI Overview is fetched at the next hourly run, or run{" "}
                    <code>python -m citewatch fetch --prompt {prompt.id} --force</code>.
                  </EmptyNote>
                )}
                {snapshot.data && !snapshot.data.has_aio && (
                  <EmptyNote>Google showed no AI Overview for this prompt on {formatDate(snapshot.data.fetched_at)}.</EmptyNote>
                )}
                {prepared && snapshot.data && (
                  <>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <Metric label="Sources cited" value={prepared.sources.filter((s) => s.inline).length} />
                      <Metric
                        label="Brands mentioned"
                        value={`${stats.filter((s) => s.mentions).length}/${stats.length}`}
                      />
                      {own ? (
                        <Metric label={`${own.brand.name} position`} value={own.position ? `#${own.position}` : "—"} />
                      ) : (
                        <Metric label="First brand mentioned" value={top?.brand.name ?? "—"} />
                      )}
                      <Metric label="Answer length" value={`${words} words`} />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                      <Card className="[--card-spacing:--spacing(6)]">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2.5">
                            <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 via-violet-500 to-rose-500 text-white">
                              <Sparkles className="size-3.5" />
                            </span>
                            <span>
                              AI Overview
                              <span className="block text-xs font-normal text-muted-foreground">
                                {formatDate(snapshot.data.fetched_at)}
                              </span>
                            </span>
                          </CardTitle>
                          {snapshot.data.check_url && (
                            <CardAction>
                              <Button variant="outline" size="sm" asChild>
                                <a href={snapshot.data.check_url} target="_blank" rel="noreferrer">
                                  View on Google <ExternalLink />
                                </a>
                              </Button>
                            </CardAction>
                          )}
                        </CardHeader>
                        <CardContent>
                          <AnswerMarkdown
                            markdown={prepared.markdown}
                            sources={prepared.sources}
                            brands={brands}
                            tones={tones}
                            activeRank={activeRank}
                            activeBrand={activeBrand}
                            onRankHover={setActiveRank}
                          />
                          {prepared.followUp && (
                            <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
                              <MessageCircleQuestion className="mt-0.5 size-4 shrink-0" />
                              <span>
                                <span className="block text-xs font-medium text-foreground">Follow-up Google suggests</span>
                                {prepared.followUp}
                              </span>
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      <div className="space-y-4">
                        <BrandsPanel
                          stats={stats}
                          tones={tones}
                          activeBrand={activeBrand}
                          onBrandHover={setActiveBrand}
                          onAdd={async (names) => {
                            try {
                              await sendJson("/api/brands", "POST", { project: prompt.project, name: names })
                              setVersion((v) => v + 1)
                              return null
                            } catch (e) {
                              return (e as Error).message
                            }
                          }}
                          onRemove={(brand) => {
                            if (brand.local) return saveLocal(localBrands.filter((b) => b.name !== brand.name))
                            void sendJson("/api/brands", "DELETE", { project: prompt.project, name: brand.name })
                              .then(() => setVersion((v) => v + 1))
                              .catch((e: Error) => alert(e.message))
                          }}
                        />
                        <SourcesPanel
                          sources={prepared.sources}
                          history={sourceHistory.data}
                          activeRank={activeRank}
                          onRankHover={setActiveRank}
                        />
                      </div>
                    </div>
                  </>
                )}
                {snapshot.loading && !snapshot.data && <Skeleton className="h-96 w-full rounded-xl" />}
              </TabsContent>

              <TabsContent value="history" className="mt-4">
                <HistoryTab history={sourceHistory.data} />
              </TabsContent>
              <TabsContent value="brief" className="mt-4">
                <BriefTab key={promptId} briefs={briefs.data} run={briefRuns[prompt.id]} onRun={() => runBrief(prompt.id)} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        status={keys.data}
        onSaved={() => setKeysVersion((v) => v + 1)}
      />
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onCreated={(id) => refresh({ project: id, prompt: undefined })}
      />
      {project && (
        <AddPromptDialog
          project={project}
          open={addPromptOpen}
          onOpenChange={setAddPromptOpen}
          onAdded={(id) => refresh({ project: project.id, prompt: id })}
        />
      )}
    </div>
  )
}

function parseHash(): { project: string | null; prompt: string | null } {
  const [a, b] = decodeURIComponent(location.hash.slice(1)).split("/")
  // "#project/prompt" (current) or "#prompt" (older links); a lone project id is resolved later.
  return b !== undefined ? { project: a || null, prompt: b || null } : { project: null, prompt: a || null }
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-heading text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">{children}</div>
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm">
      <p className="font-medium text-destructive">Can't reach the tracker API</p>
      <p className="mt-1 text-muted-foreground">
        Start it with <code>python -m citewatch serve</code>. ({message})
      </p>
    </div>
  )
}
