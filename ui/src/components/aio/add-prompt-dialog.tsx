import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { locationFlag, locationName, sendJson } from "@/lib/api"
import type { Project } from "@/lib/types"

type Props = {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: (promptId: string) => void
}

export function AddPromptDialog({ project, open, onOpenChange, onAdded }: Props) {
  const [keyword, setKeyword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = (next: boolean) => {
    if (busy) return
    onOpenChange(next)
    if (!next) {
      setKeyword("")
      setError(null)
    }
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await sendJson<{ id: string }>("/api/prompts", "POST", { keyword, project: project.id })
      setBusy(false)
      close(false)
      onAdded(r.id)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add prompt to {project.name}</DialogTitle>
          <DialogDescription>
            Tracked in {locationFlag(project.location_code)} {locationName(project.location_code)}
            {project.language_code ? ` · ${project.language_code.toUpperCase()}` : ""}
            {project.device ? ` · ${project.device}` : ""}. The first AI Overview is fetched at the next hourly run.
          </DialogDescription>
        </DialogHeader>
        <form
          id="add-prompt"
          className="grid gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Label htmlFor="ap-keyword">Search prompt</Label>
          <Input
            id="ap-keyword"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={project.language_code === "tr" ? "e.g. en iyi proje yönetim aracı" : "e.g. best project management software"}
            maxLength={700}
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="add-prompt" disabled={!keyword.trim() || busy}>
            {busy && <Loader2 className="animate-spin" />} Add prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
