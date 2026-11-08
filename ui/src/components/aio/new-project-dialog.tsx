import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MARKETS, sendJson } from "@/lib/api"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (projectId: string) => void
}

export function NewProjectDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState("")
  const [market, setMarket] = useState<string>(String(MARKETS[0].location_code))
  const [device, setDevice] = useState("desktop")
  const [brand, setBrand] = useState("")
  const [domain, setDomain] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = (next: boolean) => {
    if (busy) return
    onOpenChange(next)
    if (!next) {
      setName("")
      setBrand("")
      setDomain("")
      setError(null)
    }
  }

  const submit = async () => {
    const m = MARKETS.find((x) => String(x.location_code) === market)!
    setBusy(true)
    setError(null)
    try {
      const r = await sendJson<{ id: string }>("/api/projects", "POST", {
        name,
        location_code: m.location_code,
        language_code: m.language_code,
        brief_language: m.brief_language,
        device,
        own_brand: brand,
        own_domain: domain,
      })
      setBusy(false)
      close(false)
      onCreated(r.id)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A project groups prompts for one brand in one market. Its prompts are fetched in that market, and briefs are
            written in its language for your brand.
          </DialogDescription>
        </DialogHeader>
        <form
          id="new-project"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="np-name">Project name</Label>
            <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme · Germany" autoFocus />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="grid gap-1.5">
              <Label>Market</Label>
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETS.map((m) => (
                    <SelectItem key={m.location_code} value={String(m.location_code)}>
                      {m.flag} {m.label} · {m.language_code.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Device</Label>
              <Select value={device} onValueChange={setDevice}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desktop">Desktop</SelectItem>
                  <SelectItem value="mobile">Mobile</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="np-brand">Your brand</Label>
              <Input
                id="np-brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Acme, Acme Inc"
                title="Separate spellings with commas: the first is the name, the rest are matched too"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-domain">Brand domain</Label>
              <Input id="np-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="new-project" disabled={!name.trim() || busy}>
            {busy && <Loader2 className="animate-spin" />} Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
