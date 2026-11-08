import { useEffect, useState } from "react"

/** Fetch JSON from the tracker API; refetches when `url` or `version` changes. `null` url = idle. */
export function useApi<T>(url: string | null, version = 0) {
  // Data is tagged with the URL it came from, so switching URL (or to null) never shows another
  // resource's data; a refetch of the same URL keeps the old data on screen until the new arrives.
  const [result, setResult] = useState<{ url: string; data: T } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
        return r.json() as Promise<T>
      })
      .then((d) => !cancelled && setResult({ url, data: d }))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [url, version])

  return { data: url && result?.url === url ? result.data : null, error, loading }
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso))
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  if (s < 60) return rtf.format(-Math.round(s), "second")
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute")
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour")
  return rtf.format(-Math.round(s / 86400), "day")
}

/** Markets offered when creating a project (DataForSEO location + language codes). */
export const MARKETS = [
  { label: "Türkiye", flag: "🇹🇷", location_code: 2792, language_code: "tr", brief_language: "Turkish" },
  { label: "United States", flag: "🇺🇸", location_code: 2840, language_code: "en", brief_language: "English" },
  { label: "United Kingdom", flag: "🇬🇧", location_code: 2826, language_code: "en", brief_language: "English" },
  { label: "Germany", flag: "🇩🇪", location_code: 2276, language_code: "de", brief_language: "German" },
  { label: "France", flag: "🇫🇷", location_code: 2250, language_code: "fr", brief_language: "French" },
  { label: "Spain", flag: "🇪🇸", location_code: 2724, language_code: "es", brief_language: "Spanish" },
  { label: "Italy", flag: "🇮🇹", location_code: 2380, language_code: "it", brief_language: "Italian" },
  { label: "Netherlands", flag: "🇳🇱", location_code: 2528, language_code: "nl", brief_language: "Dutch" },
] as const

export const locationName = (code: number | null | undefined) =>
  MARKETS.find((m) => m.location_code === code)?.label ?? (code ? `Location ${code}` : "Default market")
export const locationFlag = (code: number | null | undefined) => MARKETS.find((m) => m.location_code === code)?.flag ?? "🌐"

/** Send a JSON write request to the tracker API; throws with the server's error message. */
export async function sendJson<T>(url: string, method: "POST" | "PATCH" | "DELETE", body: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
  return data as T
}
