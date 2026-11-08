import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { SourceHistory } from "@/lib/types"

import { Favicon } from "./favicon"

export function HistoryTab({ history }: { history: SourceHistory | null }) {
  if (!history || history.snapshots === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No AI Overview snapshots yet.</p>
  }
  const n = history.snapshots
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Domain citation share</CardTitle>
          <CardDescription>Share of the {n} stored AI Overview{n === 1 ? "" : "s"} citing each domain</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead className="w-[45%]">Share</TableHead>
                <TableHead className="text-right">Days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.domains.map((d) => (
                <TableRow key={d.domain}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <Favicon domain={d.domain} />
                      {d.domain.replace(/^www\./, "")}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-foreground/70" style={{ width: `${(d.count / n) * 100}%` }} />
                      </div>
                      <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                        {Math.round((d.count / n) * 100)}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {d.count}/{n}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Most cited pages</CardTitle>
          <CardDescription>Individual URLs across all stored snapshots</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {history.urls.map((u) => (
              <li key={u.url} className="flex items-center gap-3 py-2.5">
                <Favicon domain={new URL(u.url).hostname} />
                <a href={u.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
                  <p className="truncate text-sm font-medium">{u.title || u.url}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.url}</p>
                </a>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {u.count}/{n}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
