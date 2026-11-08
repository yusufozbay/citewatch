import { useEffect, useState } from "react"
import { CircleAlert, CircleCheck, ExternalLink, Loader2, ShieldCheck } from "lucide-react"

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
import { Separator } from "@/components/ui/separator"
import { sendJson } from "@/lib/api"

type KeyState = { set: boolean; last4: string }
export type KeyStatus = {
  dataforseo_login: KeyState
  dataforseo_password: KeyState
  gemini_api_key: KeyState
  ai_provider: "gemini" | "anthropic"
}
type Field = "dataforseo_login" | "dataforseo_password" | "gemini_api_key"
type Provider = "dataforseo" | "gemini"
type TestResult = { ok: boolean; error?: string; balance?: number | null }
type TestState = { running?: boolean; result?: TestResult }

/** Keys the tracker can't work without: DataForSEO always, Gemini when it writes the briefs. */
export function keysMissing(s: KeyStatus) {
  return !s.dataforseo_login.set || !s.dataforseo_password.set || (s.ai_provider === "gemini" && !s.gemini_api_key.set)
}

const EMPTY: Record<Field, string> = { dataforseo_login: "", dataforseo_password: "", gemini_api_key: "" }
const PROVIDER_FIELDS: Record<Provider, Field[]> = {
  dataforseo: ["dataforseo_login", "dataforseo_password"],
  gemini: ["gemini_api_key"],
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: KeyStatus | null
  onSaved: () => void
}

export function SettingsDialog({ open, onOpenChange, status, onSaved }: Props) {
  // Typed values only; saved keys stay on the server and show as "ends in 1234".
  const [values, setValues] = useState(EMPTY)
  const [tests, setTests] = useState<Partial<Record<Provider, TestState>>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setValues(EMPTY)
      setTests({})
      setSaved(false)
      setError(null)
    }
  }, [open])

  const set = (field: Field, value: string) => {
    setValues((v) => ({ ...v, [field]: value }))
    setSaved(false)
    // A result is about what was tested, so drop it once the inputs change.
    const provider = (Object.keys(PROVIDER_FIELDS) as Provider[]).find((p) => PROVIDER_FIELDS[p].includes(field))!
    setTests((t) => ({ ...t, [provider]: undefined }))
  }

  const test = async (provider: Provider) => {
    setTests((t) => ({ ...t, [provider]: { running: true } }))
    // Blank inputs mean "test the saved key".
    const body: Record<string, string> = { provider }
    for (const f of PROVIDER_FIELDS[provider]) if (values[f].trim()) body[f] = values[f]
    let result: TestResult
    try {
      result = await sendJson<TestResult>("/api/settings/test", "POST", body)
    } catch (e) {
      result = { ok: false, error: (e as Error).message }
    }
    setTests((t) => ({ ...t, [provider]: { result } }))
  }

  const dirty = Object.values(values).some((v) => v.trim())

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await sendJson("/api/settings/keys", "POST", values)
      const changed = (Object.keys(PROVIDER_FIELDS) as Provider[]).filter((p) => PROVIDER_FIELDS[p].some((f) => values[f].trim()))
      setValues(EMPTY)
      setSaved(true)
      onSaved()
      // Check what was just saved, so a wrong key shows up now rather than at the next scheduled run.
      changed.forEach((p) => void test(p))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const hint = (field: Field) => {
    const s = status?.[field]
    if (!s?.set) return "Not set"
    return s.last4 ? `Saved · ends in ${s.last4}` : "Saved"
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect your APIs</DialogTitle>
          <DialogDescription>
            CiteWatch uses your own accounts: DataForSEO to look up Google's AI Overviews, and Gemini to write briefs.
            Paste your keys below, test them, and save.
          </DialogDescription>
        </DialogHeader>
        <form
          id="settings-keys"
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <section className="grid gap-3">
            <ProviderHeading
              title="DataForSEO"
              links={[
                { href: "https://app.dataforseo.com/register", label: "Create an account" },
                { href: "https://app.dataforseo.com/api-access", label: "Find your API login" },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="k-dfs-login">API login</Label>
                <Input
                  id="k-dfs-login"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={values.dataforseo_login}
                  onChange={(e) => set("dataforseo_login", e.target.value)}
                  placeholder={hint("dataforseo_login")}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="k-dfs-password">API password</Label>
                <Input
                  id="k-dfs-password"
                  type="password"
                  autoComplete="new-password"
                  value={values.dataforseo_password}
                  onChange={(e) => set("dataforseo_password", e.target.value)}
                  placeholder={hint("dataforseo_password")}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The API password is not your website password: it's on the API access page of your DataForSEO dashboard.
            </p>
            <TestRow state={tests.dataforseo} onTest={() => void test("dataforseo")} />
          </section>

          <Separator />

          <section className="grid gap-3">
            <ProviderHeading title="Google Gemini" links={[{ href: "https://aistudio.google.com/apikey", label: "Get an API key" }]} />
            {status?.ai_provider === "anthropic" && (
              <p className="text-xs text-muted-foreground">
                Briefs are set to use Anthropic in config.toml, so this key is optional.
              </p>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="k-gemini">API key</Label>
              <Input
                id="k-gemini"
                type="password"
                autoComplete="new-password"
                value={values.gemini_api_key}
                onChange={(e) => set("gemini_api_key", e.target.value)}
                placeholder={hint("gemini_api_key")}
              />
            </div>
            <TestRow state={tests.gemini} onTest={() => void test("gemini")} />
          </section>

          <div className="grid gap-1.5 rounded-lg bg-muted/60 px-3.5 py-3 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">What it costs.</span> You pay the providers directly. Each
              AI Overview lookup is one DataForSEO call, about $0.004. Each brief is one Gemini call. Testing your keys
              is free.
            </p>
            <p className="flex gap-1.5">
              <ShieldCheck className="mt-px size-3.5 shrink-0" />
              <span>
                Your keys are saved in the <code>.env</code> file of this install and never leave this computer, except
                to go to DataForSEO and Google themselves.
              </span>
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter className="items-center">
          {saved && <p className="mr-auto text-sm text-muted-foreground">Saved. Keys are in use now.</p>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {saved ? "Done" : "Close"}
          </Button>
          <Button type="submit" form="settings-keys" disabled={!dirty || saving}>
            {saving && <Loader2 className="animate-spin" />} Save keys
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProviderHeading({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {l.label} <ExternalLink className="size-3" />
        </a>
      ))}
    </div>
  )
}

function TestRow({ state, onTest }: { state?: TestState; onTest: () => void }) {
  const r = state?.result
  return (
    <div className="flex min-h-8 items-center gap-3">
      <Button type="button" variant="outline" size="sm" onClick={onTest} disabled={state?.running}>
        {state?.running && <Loader2 className="animate-spin" />} Test
      </Button>
      {r?.ok && (
        <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
          <CircleCheck className="size-4" /> Connected
          {r.balance != null && <span className="text-muted-foreground">· balance ${r.balance.toFixed(2)}</span>}
        </p>
      )}
      {r && !r.ok && (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {r.error}
        </p>
      )}
    </div>
  )
}
