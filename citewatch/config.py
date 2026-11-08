"""Load config.toml and .env."""

from __future__ import annotations

import os
import shutil
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


# Settings a project can set for all its prompts; a prompt may still override each one.
INHERITED = ("location_code", "language_code", "device", "brief_language", "brand")
DEFAULT_PROJECT = "general"


@dataclass
class Project:
    id: str
    name: str
    location_code: int | None = None
    language_code: str | None = None
    device: str | None = None
    brief_language: str | None = None
    brand: str | None = None  # who briefs are written for, e.g. "Acme (acme.com)"


@dataclass
class Prompt:
    id: str
    keyword: str
    location_code: int
    language_code: str
    device: str
    brief_language: str | None = None  # resolved: prompt > project > [ai] brief_language
    brand: str | None = None  # resolved: prompt > project > [ai] brand
    project: str = DEFAULT_PROJECT


@dataclass
class Config:
    fetch_every_hours: float
    brief_every_days: float
    min_snapshots_for_brief: int
    brief_window_days: float
    source: str
    provider: str
    model: str
    effort: str
    brand: str
    brief_language: str
    auto_briefs: bool = True  # false = the hourly run never writes briefs; manual ones still work
    prompts: list[Prompt] = field(default_factory=list)
    projects: list[Project] = field(default_factory=list)
    # [dataforseo] defaults, used by prompts whose project sets no market.
    default_location_code: int = 2840
    default_language_code: str = "en"
    default_device: str = "desktop"
    db_path: Path = ROOT / "data" / "aio.sqlite3"
    briefs_dir: Path = ROOT / "briefs"


def load_env(path: Path = ROOT / ".env") -> None:
    """Minimal .env loader: KEY=VALUE lines; existing env vars win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def load_config(path: Path = ROOT / "config.toml") -> Config:
    if not path.exists() and path == ROOT / "config.toml":  # first run: start from the sample project
        shutil.copyfile(ROOT / "config.example.toml", path)
    raw = tomllib.loads(path.read_text())
    sched = raw.get("schedule", {})
    dfs = raw.get("dataforseo", {})
    ai = raw.get("ai", {})

    source = dfs.get("source", "google_aio")
    if source not in ("google_aio", "google_ai_mode"):
        raise ValueError(f"dataforseo.source must be google_aio or google_ai_mode, got {source!r}")

    provider = ai.get("provider", "gemini")
    if provider not in ("gemini", "anthropic"):
        raise ValueError(f"ai.provider must be gemini or anthropic, got {provider!r}")
    default_model = "gemini-4-argon" if provider == "gemini" else "claude-opus-5-5"

    projects: dict[str, Project] = {}
    for pr in raw.get("projects", []):
        if pr["id"] in projects:
            raise ValueError(f"duplicate project id {pr['id']!r}")
        projects[pr["id"]] = Project(id=pr["id"], name=pr.get("name", pr["id"]), **{k: pr.get(k) for k in INHERITED})

    prompts = []
    seen = set()
    for p in raw.get("prompts", []):
        pid = p["id"]
        if pid in seen:
            raise ValueError(f"duplicate prompt id {pid!r}")
        seen.add(pid)
        project_id = p.get("project", DEFAULT_PROJECT)
        # Unknown or missing project: keep the prompt working under a placeholder project.
        project = projects.setdefault(
            project_id, Project(id=project_id, name="General" if project_id == DEFAULT_PROJECT else project_id)
        )

        def pick(key, fallback):
            for value in (p.get(key), getattr(project, key)):
                if value is not None:
                    return value
            return fallback

        prompts.append(
            Prompt(
                id=pid,
                keyword=p["keyword"],
                location_code=int(pick("location_code", dfs.get("location_code", 2840))),
                language_code=pick("language_code", dfs.get("language_code", "en")),
                device=pick("device", dfs.get("device", "desktop")),
                brief_language=pick("brief_language", None),
                brand=pick("brand", None),
                project=project_id,
            )
        )

    return Config(
        fetch_every_hours=float(sched.get("fetch_every_hours", 24)),
        brief_every_days=float(sched.get("brief_every_days", 7)),
        min_snapshots_for_brief=int(sched.get("min_snapshots_for_brief", 3)),
        brief_window_days=float(sched.get("brief_window_days", 7)),
        auto_briefs=bool(sched.get("auto_briefs", True)),
        source=source,
        provider=provider,
        model=ai.get("model", default_model),
        effort=ai.get("effort", "high"),
        brand=ai.get("brand", ""),
        brief_language=ai.get("brief_language", "English"),
        prompts=prompts,
        projects=list(projects.values()),
        default_location_code=int(dfs.get("location_code", 2840)),
        default_language_code=dfs.get("language_code", "en"),
        default_device=dfs.get("device", "desktop"),
    )
