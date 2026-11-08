import { useState } from "react"

import { cn } from "@/lib/utils"

export function Favicon({ domain, className }: { domain: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const host = domain.replace(/^www\./, "")
  if (failed || !host) {
    return (
      <span
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[9px] font-semibold uppercase text-muted-foreground",
          className,
        )}
      >
        {host.charAt(0) || "?"}
      </span>
    )
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("size-4 shrink-0 rounded-sm bg-white object-contain", className)}
    />
  )
}
