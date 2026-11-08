import { useState } from "react"
import { Check, ChevronDown, Copy, Download, FileCode2, FileText, FileType2, Globe } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Brief } from "@/lib/types"

const FORMATS = [
  { format: "docx", label: "Word", ext: ".docx", icon: FileText },
  { format: "pdf", label: "PDF", ext: ".pdf", icon: FileType2 },
  { format: "md", label: "Markdown", ext: ".md", icon: FileCode2 },
  { format: "txt", label: "Plain text", ext: ".txt", icon: FileText },
  { format: "html", label: "Web page", ext: ".html", icon: Globe },
] as const

/** Download a brief as Word, PDF, Markdown, text or HTML (built by the server), or copy its Markdown. */
export function BriefDownloadMenu({ brief }: { brief: Brief }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brief.markdown.replace(/^<!--.*?-->\s*/s, ""))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {copied ? <Check /> : <Download />} {copied ? "Copied" : "Download"} <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Download as</DropdownMenuLabel>
        {FORMATS.map(({ format, label, ext, icon: Icon }) => (
          <DropdownMenuItem key={format} asChild>
            <a href={`/api/briefs/${brief.id}/download?format=${format}`} download>
              <Icon /> {label}
              <span className="ml-auto text-xs text-muted-foreground">{ext}</span>
            </a>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={copy}>
          <Copy /> Copy as Markdown
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
