import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { formatDate } from "@/lib/api"
import type { SnapshotSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

type Props = {
  snapshots: SnapshotSummary[] // newest first
  selected: number | null
  onSelect: (id: number) => void
}

export function SnapshotTimeline({ snapshots, selected, onSelect }: Props) {
  return (
    <ScrollArea className="w-full">
      <div className="flex gap-1.5 pb-2">
        {snapshots.map((s, i) => {
          const prev = snapshots[i + 1]
          const changed = s.has_aio && prev?.has_aio && prev.text_hash !== s.text_hash
          const first = s.has_aio && !snapshots.slice(i + 1).some((p) => p.has_aio)
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={cn(
                "flex shrink-0 flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-colors hover:bg-muted",
                selected === s.id && "border-foreground/40 bg-muted",
              )}
            >
              <span className="text-xs font-medium tabular-nums">
                {formatDate(s.fetched_at, { month: "short", day: "numeric" })}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    !s.has_aio ? "bg-muted-foreground/40" : changed || first ? "bg-amber-500" : "bg-emerald-500",
                  )}
                />
                {!s.has_aio ? "No overview" : first ? "First seen" : changed ? "Changed" : "Unchanged"}
              </span>
            </button>
          )
        })}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  )
}
