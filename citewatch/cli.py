"""Command line entry point.

    python -m citewatch run        # fetch + brief, whatever is due (what the scheduler calls)
    python -m citewatch fetch      # fetch every prompt now  (--prompt ID, --force)
    python -m citewatch brief      # write briefs now        (--prompt ID, --force)
    python -m citewatch dossier ID # print the analysis input for a prompt, no AI call
    python -m citewatch status     # what is stored and what is due
    python -m citewatch serve      # web UI on http://127.0.0.1:8765
    python -m citewatch demo       # add a sample project (fictional data, no API keys needed)
    python -m citewatch delete ID  # remove a prompt and its data (asks you to type DELETE)
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import timedelta

from .brief import build_dossier, generate_brief, window_bounds
from .config import ROOT, Config, load_config, load_env
from .dataforseo import DataForSEOError, fetch
from .store import Store, iso, now, parse_iso, window_start

log = logging.getLogger("citewatch")
# Hourly scheduler ticks shouldn't skip a cycle because the last run was a few minutes late.
SLACK = timedelta(minutes=30)


def rel(path) -> str:
    return str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path)


def brief_window(cfg: Config):
    return window_start(cfg.brief_window_days) - SLACK


def fetch_due(cfg: Config, store: Store, prompt) -> bool:
    last = store.last_fetch(prompt.id)
    return last is None or now() - last >= timedelta(hours=cfg.fetch_every_hours) - SLACK


def brief_due(cfg: Config, store: Store, prompt) -> tuple[bool, str]:
    interval = timedelta(days=cfg.brief_every_days) - SLACK
    last = store.last_brief(prompt.id)
    if last:
        if now() - parse_iso(last["created_at"]) < interval:
            return False, f"last brief {last['created_at']}"
    else:
        first = store.first_snapshot(prompt.id)
        if not first or now() - first < interval:
            return False, f"collecting since {iso(first) if first else 'never'}"
    rows = store.snapshots(prompt.id, since=brief_window(cfg))
    n = sum(r["has_aio"] for r in rows)
    if n < cfg.min_snapshots_for_brief:
        return False, f"only {n} AI Overview snapshots in window (need {cfg.min_snapshots_for_brief})"
    return True, f"{n} snapshots ready"


def tracked(cfg: Config):
    """Every prompt except the sample project's, so the sample never costs a paid request by itself."""
    return [p for p in cfg.prompts if not p.id.startswith("demo-")]


def select(cfg: Config, prompt_id: str | None):
    if not prompt_id:
        return tracked(cfg)
    match = [p for p in cfg.prompts if p.id == prompt_id]
    if not match:
        sys.exit(f"unknown prompt id {prompt_id!r}; known: {', '.join(p.id for p in cfg.prompts)}")
    return match


def do_fetch(cfg, store, prompts, force: bool) -> int:
    failures = 0
    for p in prompts:
        if not force and not fetch_due(cfg, store, p):
            log.info("fetch %s: not due", p.id)
            continue
        try:
            result = fetch(p, cfg.source)
        except DataForSEOError as e:
            failures += 1
            log.error("fetch %s failed: %s", p.id, e)
            continue
        store.add_snapshot(p, cfg.source, result)
        log.info(
            "fetch %s: %s, %d references, $%.4f",
            p.id, "AI Overview found" if result.has_aio else "no AI Overview",
            len(result.references), result.cost,
        )
    return failures


def write_brief(cfg, store, p, rows) -> int:
    """Analyze `rows` with the AI, save the Markdown file and the briefs row; returns the brief id."""
    cfg.briefs_dir.mkdir(parents=True, exist_ok=True)
    log.info("brief %s: analyzing %d snapshots with %s", p.id, len(rows), cfg.model)
    out = generate_brief(cfg, p, rows)
    path = cfg.briefs_dir / f"{now().strftime('%Y-%m-%d')}_{p.id}.md"
    path.write_text(out["markdown"])
    frm, to = window_bounds(rows)
    brief_id = store.add_brief(
        prompt_id=p.id, created_at=iso(now()), window_from=iso(frm), window_to=iso(to),
        snapshot_count=len(rows), model=out["model"], path=rel(path),
        markdown=out["markdown"], input_tokens=out["input_tokens"], output_tokens=out["output_tokens"],
    )
    log.info("brief %s: saved %s (%d in / %d out tokens)",
             p.id, rel(path), out["input_tokens"], out["output_tokens"])
    return brief_id


def do_brief(cfg, store, prompts, force: bool) -> int:
    failures = 0
    for p in prompts:
        due, why = brief_due(cfg, store, p)
        rows = store.snapshots(p.id, since=brief_window(cfg))
        if not force and not due:
            log.info("brief %s: not due (%s)", p.id, why)
            continue
        if not any(r["has_aio"] for r in rows):
            log.warning("brief %s: no AI Overview snapshots in the last %s days", p.id, cfg.brief_window_days)
            continue
        try:
            write_brief(cfg, store, p, rows)
        except Exception as e:  # keep other prompts going; the error is logged
            failures += 1
            log.error("brief %s failed: %s", p.id, e)
    return failures


def do_status(cfg, store) -> None:
    print(f"source={cfg.source}  fetch every {cfg.fetch_every_hours:g}h  brief every {cfg.brief_every_days:g}d  ai={cfg.provider}/{cfg.model}\n")
    for p in cfg.prompts:
        rows = store.snapshots(p.id)
        with_aio = sum(r["has_aio"] for r in rows)
        versions = len({r["text_hash"] for r in rows if r["has_aio"]})
        last = store.last_fetch(p.id)
        lb = store.last_brief(p.id)
        due, why = brief_due(cfg, store, p)
        print(f"{p.id}  \"{p.keyword}\"")
        print(f"  snapshots: {len(rows)} ({with_aio} with AI Overview, {versions} distinct answers)")
        print(f"  last fetch: {iso(last) if last else 'never'}  next fetch due: {'yes' if fetch_due(cfg, store, p) else 'no'}")
        state = f"{'yes' if due else 'no'} ({why})" if cfg.auto_briefs else "paused (auto_briefs = false)"
        print(f"  last brief: {lb['path'] if lb else 'none'}  auto brief: {state}\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="citewatch", description="Track Google AI Overviews and write SEO/GEO briefs.")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("fetch", "brief"):
        sp = sub.add_parser(name)
        sp.add_argument("--prompt", help="only this prompt id")
        sp.add_argument("--force", action="store_true", help="ignore the schedule")
    sub.add_parser("run", help="fetch and brief whatever is due (for cron/launchd)")
    sub.add_parser("status")
    sp = sub.add_parser("delete", help="delete a prompt from config.toml and all its stored data")
    sp.add_argument("prompt")
    sp = sub.add_parser("serve", help="serve the web UI and JSON API")
    sp.add_argument("--port", type=int, default=8765)
    sp = sub.add_parser("demo", help="add a sample project with fictional data, so you can look around without API keys")
    sp.add_argument("--clear", action="store_true", help="remove the sample project and its data")
    sp = sub.add_parser("dossier", help="print the analysis input for a prompt, without calling the AI")
    sp.add_argument("prompt")
    args = ap.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    load_env()
    cfg = load_config()
    store = Store(cfg.db_path)

    if args.cmd == "fetch":
        return int(do_fetch(cfg, store, select(cfg, args.prompt), args.force) > 0)
    if args.cmd == "brief":
        return int(do_brief(cfg, store, select(cfg, args.prompt), args.force) > 0)
    if args.cmd == "run":
        failed = do_fetch(cfg, store, tracked(cfg), False)
        if cfg.auto_briefs:
            failed += do_brief(cfg, store, tracked(cfg), False)
        else:
            log.info("briefs: automatic briefs are paused ([schedule] auto_briefs = false)")
        return int(failed > 0)
    if args.cmd == "demo":
        from .demo import clear_demo, seed_demo

        print(clear_demo(cfg, store) if args.clear else seed_demo(cfg, store))
        return 0
    if args.cmd == "status":
        do_status(cfg, store)
        return 0
    if args.cmd == "delete":
        from .admin import CONFIRM_WORD, NotFound, delete_prompt

        p = select(cfg, args.prompt)[0]
        n = len(store.snapshots(p.id))
        print(f'This permanently deletes "{p.keyword}" ({p.id}) and its {n} stored snapshot(s) and briefs.')
        if input(f"Type {CONFIRM_WORD} to confirm: ").strip() != CONFIRM_WORD:
            print("Cancelled.")
            return 1
        try:
            print(delete_prompt(cfg, p.id))
        except NotFound:
            sys.exit(f"unknown prompt id {p.id!r}")
        return 0
    if args.cmd == "serve":
        from .server import serve

        serve(cfg, port=args.port)
        return 0
    if args.cmd == "dossier":
        p = select(cfg, args.prompt)[0]
        text, _ = build_dossier(p, store.snapshots(p.id, since=brief_window(cfg)))
        print(text)
        return 0
    return 1
