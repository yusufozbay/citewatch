import { Loader2, Play } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { RunState } from "@/lib/types"
import { cn } from "@/lib/utils"

type Props = {
  run: RunState | undefined
  onRun: () => void
  /** Icon-only, for table rows. */
  compact?: boolean
  className?: string
}

/** Fetches the prompt's AI Overview from DataForSEO right now, outside the schedule. */
export function RunPromptButton({ run, onRun, compact, className }: Props) {
  const running = !!run?.running
  const button = (
    <Button
      variant="outline"
      size={compact ? "icon-xs" : "sm"}
      disabled={running}
      aria-label={compact ? "Run prompt now" : undefined}
      className={className}
      onClick={(e) => {
        e.stopPropagation()
        onRun()
      }}
    >
      {running ? <Loader2 className="animate-spin" /> : <Play />}
      {!compact && (running ? "Running…" : "Run")}
    </Button>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{running ? "Fetching from Google…" : "Fetch this prompt's AI Overview now (one paid DataForSEO request)"}</TooltipContent>
    </Tooltip>
  )
}

/** One line under the button saying how the last run went. */
export function RunStatus({ run, className }: { run: RunState | undefined; className?: string }) {
  if (!run || run.running) return null
  if (run.error) return <p className={cn("text-xs text-destructive", className)}>Run failed: {run.error}</p>
  if (!run.result) return null
  const r = run.result
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      {r.has_aio ? `New AI Overview fetched · ${r.references} sources` : "Fetched · Google showed no AI Overview"} · ${r.cost.toFixed(4)}
    </p>
  )
}
