import { Check, ChevronsUpDown, FolderPlus } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { locationFlag, locationName } from "@/lib/api"
import type { Project } from "@/lib/types"

type Props = {
  projects: Project[]
  current: Project | undefined
  onSelect: (id: string) => void
  onNew: () => void
}

function marketLine(p: Project) {
  return `${locationName(p.location_code)}${p.language_code ? ` · ${p.language_code.toUpperCase()}` : ""}`
}

export function ProjectSwitcher({ projects, current, onSelect, onNew }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2.5 rounded-lg border bg-background px-2.5 py-2 text-left transition-colors hover:bg-muted data-[state=open]:bg-muted">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-base">
            {current ? locationFlag(current.location_code) : "📁"}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-medium">{current?.name ?? "Select a project"}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {current ? `${current.own_brand ?? "No brand"} · ${marketLine(current)}` : `${projects.length} projects`}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Projects</DropdownMenuLabel>
        {projects.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => onSelect(p.id)} className="gap-2.5 py-2">
            <span className="text-base">{locationFlag(p.location_code)}</span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm">{p.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {p.prompts} prompt{p.prompts === 1 ? "" : "s"} · {marketLine(p)}
              </span>
            </span>
            {current?.id === p.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNew} className="gap-2.5">
          <FolderPlus className="size-4" /> New project…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
