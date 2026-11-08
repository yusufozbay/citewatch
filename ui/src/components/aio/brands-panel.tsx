import { useState } from "react"
import { Check, Plus, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TONE_CLASSES, type BrandStat, type Tone } from "@/lib/answer"
import { cn } from "@/lib/utils"

type Props = {
  stats: BrandStat[]
  tones: Map<string, Tone>
  activeBrand: string | null
  onBrandHover: (name: string | null) => void
  /** Saves the brand to the current project; resolves to an error message, or null on success. */
  onAdd: (names: string) => Promise<string | null>
  onRemove: (brand: BrandStat["brand"]) => void
}

export function BrandsPanel({ stats, tones, activeBrand, onBrandHover, onAdd, onRemove }: Props) {
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mentioned = stats.filter((s) => s.mentions > 0).length

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Brands
          <Badge variant="secondary">
            {mentioned}/{stats.length} mentioned
          </Badge>
        </CardTitle>
        <CardDescription>Position = order of first mention</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-2">
        {stats.length === 0 && (
          <p className="px-2 text-sm text-muted-foreground">
            No brands yet. Add one below or under <code className="text-xs">[[brands]]</code> in config.toml.
          </p>
        )}
        <ul className="space-y-0.5">
          {stats.map((s) => {
            const tone = tones.get(s.brand.name) ?? "violet"
            const off = s.mentions === 0
            return (
              <li
                key={s.brand.name}
                onMouseEnter={() => !off && onBrandHover(s.brand.name)}
                onMouseLeave={() => onBrandHover(null)}
                className={cn(
                  "group flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/70",
                  activeBrand === s.brand.name && "bg-muted",
                  off && "opacity-55",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums",
                    off ? "border text-muted-foreground" : TONE_CLASSES[tone].mark + " ring-1 ring-inset",
                  )}
                >
                  {s.position ?? "–"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">{s.brand.name}</span>
                    {s.brand.own && <Badge className="h-4 px-1.5 text-[10px]">You</Badge>}
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                      {off ? "Not mentioned" : `${s.mentions}× mentioned`}
                    </span>
                  </div>
                  {s.context && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{s.context}</p>}
                  {s.brand.domains.length > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                      {s.cited ? (
                        <>
                          <Check className="size-3 text-emerald-600" /> Own site cited · source #{s.sourceRank}
                        </>
                      ) : (
                        <>Own site not cited</>
                      )}
                    </p>
                  )}
                </div>
                {!s.brand.own && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 opacity-0 group-hover:opacity-100"
                        onClick={() => onRemove(s.brand)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{s.brand.local ? "Remove (saved in this browser only)" : "Stop tracking in this project"}</TooltipContent>
                  </Tooltip>
                )}
              </li>
            )
          })}
        </ul>
        <form
          className="flex gap-2 px-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!draft.trim() || busy) return
            setBusy(true)
            setError(null)
            void onAdd(draft.trim()).then((err) => {
              setBusy(false)
              setError(err)
              if (!err) setDraft("")
            })
          }}
        >
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add brand, e.g. Acme, Acme Inc"
            title="Separate spellings with commas: the first is the name, the rest are matched too" className="h-8" />
          <Button type="submit" size="sm" variant="outline" disabled={!draft.trim() || busy}>
            <Plus /> Add
          </Button>
        </form>
        {error && <p className="px-2 text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
