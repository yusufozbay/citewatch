import { useEffect, useState } from "react"
import { FileText, Loader2, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate } from "@/lib/api"
import type { Brief, BriefRunState } from "@/lib/types"

import { AnswerMarkdown } from "./answer-markdown"
import { BriefDownloadMenu } from "./brief-download-menu"

type Props = {
  briefs: Brief[] | null
  run: BriefRunState | undefined
  onRun: () => void
}

/** Writes a new brief now from the snapshots in the brief window (one AI call). */
function GenerateButton({ run, onRun, label = "Generate brief" }: { run: BriefRunState | undefined; onRun: () => void; label?: string }) {
  return (
    <Button size="sm" variant="outline" disabled={run?.running} onClick={onRun}>
      {run?.running ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {run?.running ? "Writing brief…" : label}
    </Button>
  )
}

function RunNote({ run }: { run: BriefRunState | undefined }) {
  if (run?.running) return <p className="text-xs text-muted-foreground">Analyzing the snapshots. This usually takes 1–3 minutes.</p>
  if (run?.error) return <p className="text-xs text-destructive">Brief failed: {run.error}</p>
  return null
}

export function BriefTab({ briefs, run, onRun }: Props) {
  const [index, setIndex] = useState(0)
  const newest = briefs?.[0]?.id
  useEffect(() => setIndex(0), [newest]) // a freshly generated brief opens on top
  if (!briefs?.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <FileText className="size-8 text-muted-foreground/60" />
        <p className="text-sm font-medium">No brief yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          A brief is written automatically after a week of snapshots. You can also write one now from the snapshots stored so far.
        </p>
        <div className="mt-2">
          <GenerateButton run={run} onRun={onRun} />
        </div>
        <RunNote run={run} />
      </div>
    )
  }
  const b = briefs[Math.min(index, briefs.length - 1)]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Blog post brief</CardTitle>
        <CardAction className="flex items-center gap-1.5">
          <GenerateButton run={run} onRun={onRun} label="New brief" />
          <BriefDownloadMenu brief={b} />
        </CardAction>
        <CardDescription className="flex flex-wrap items-center gap-2">
          {formatDate(b.created_at)} · {b.snapshot_count} snapshots · <Badge variant="outline">{b.model}</Badge>
        </CardDescription>
        <RunNote run={run} />
        {briefs.length > 1 && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {briefs.map((x, i) => (
              <Button key={x.id} size="xs" variant={i === index ? "default" : "outline"} onClick={() => setIndex(i)}>
                {formatDate(x.created_at, { dateStyle: "medium" })}
              </Button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <AnswerMarkdown markdown={b.markdown.replace(/^<!--.*?-->\s*/s, "")} />
      </CardContent>
    </Card>
  )
}
