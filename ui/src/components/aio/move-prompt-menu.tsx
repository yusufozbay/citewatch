import { useState } from "react"
import { FolderInput } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { locationFlag, sendJson } from "@/lib/api"
import type { Project, PromptSummary } from "@/lib/types"

type Props = {
  prompt: PromptSummary
  projects: Project[]
  onMoved: (projectId: string) => void
}

export function MovePromptMenu({ prompt, projects, onMoved }: Props) {
  const [error, setError] = useState<string | null>(null)
  if (projects.length < 2) return null

  const move = async (projectId: string) => {
    if (projectId === prompt.project) return
    setError(null)
    try {
      await sendJson(`/api/prompts/${encodeURIComponent(prompt.id)}`, "PATCH", { project: projectId })
      onMoved(projectId)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground" title={error ?? undefined}>
          <FolderInput /> Move
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Move to project · settings come from the new project
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={prompt.project} onValueChange={(v) => void move(v)}>
          {projects.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id}>
              {locationFlag(p.location_code)} {p.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
