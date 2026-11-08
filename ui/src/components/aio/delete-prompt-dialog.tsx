import { useState } from "react"
import { Loader2, Trash2, TriangleAlert } from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { PromptSummary } from "@/lib/types"

const CONFIRM_WORD = "DELETE"

export type DeleteResult = {
  id: string
  keyword: string
  snapshots_deleted: number
  briefs_deleted: number
  brands_removed: string[]
  brands_updated: string[]
  brief_files_kept: string[]
}

type Props = {
  prompt: PromptSummary
  onDeleted: (result: DeleteResult) => void
}

export function DeletePromptDialog({ prompt, onDeleted }: Props) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const armed = typed === CONFIRM_WORD

  const reset = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setTyped("")
      setError(null)
    }
  }

  const submit = async () => {
    if (!armed || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/prompts/${encodeURIComponent(prompt.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: typed }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
      reset(false)
      onDeleted(data as DeleteResult)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && reset(o)}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
          <Trash2 /> Delete prompt
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <TriangleAlert />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete this prompt permanently?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                <span className="font-medium text-foreground">“{prompt.keyword}”</span> will stop being tracked, and
                everything stored for it is deleted. This can't be undone.
              </p>
              <ul className="list-disc space-y-1 pl-4 text-left">
                <li>
                  {prompt.snapshots} AI Overview snapshot{prompt.snapshots === 1 ? "" : "s"}
                </li>
                <li>
                  {prompt.briefs} brief{prompt.briefs === 1 ? "" : "s"} in the database (Markdown files in{" "}
                  <code className="text-xs">briefs/</code> are kept)
                </li>
                <li>
                  Its entry in <code className="text-xs">config.toml</code>, plus brands only tracked for this prompt
                  (a backup is saved as <code className="text-xs">config.toml.bak</code>)
                </li>
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label htmlFor="confirm-delete" className="text-sm">
            Type <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold">{CONFIRM_WORD}</span>{" "}
            to confirm
          </label>
          <Input
            id="confirm-delete"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={CONFIRM_WORD}
            aria-invalid={typed.length > 0 && !CONFIRM_WORD.startsWith(typed)}
            disabled={busy}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={!armed || busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete prompt
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
