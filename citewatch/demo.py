"""A sample project with fictional snapshots and one brief, for trying the app without API keys."""

from __future__ import annotations

import random
from datetime import timedelta

import tomlkit

from .admin import CONFIG
from .dataforseo import AIOResult
from .store import iso, now

BRANDS = ["Planbright", "Taskforge", "Orbit Boards", "Northwind Tasks"]
SITES = {
    "planbright.example": "Planbright pricing and features",
    "taskforge.example": "Taskforge for growing teams",
    "orbit-boards.example": "Orbit Boards product tour",
    "northwind-tasks.example": "Northwind Tasks: a guide for small teams",
    "reviewhub.example": "Project management software reviews",
    "teamops-weekly.example": "How we picked a task tracker",
    "saas-compare.example": "Project management tools compared",
    "startup-forum.example": "What does your team use?",
    "work-wiki.example": "Task management (overview)",
    "pm-institute.example": "Choosing project management software",
}
CORE = ["reviewhub.example", "saas-compare.example"]
EDGE = [d for d in SITES if d not in CORE]
BRIEF = """# Sample brief: best project management tool for small teams

*Everything in this brief is fictional. It shows the format of a real one.*

## 1. Snapshot analysis

**Search intent:** commercial comparison by small-team leads who want a shortlist.

**Presence:** an AI Overview appeared in every sample snapshot.

### Stable core (in every snapshot)
- Named shortlist of three to four tools
- Pricing per user as the main comparison point
- Ease of setup for teams under 20 people

### Volatile edge (comes and goes)
- Time tracking and reporting
- Migration from spreadsheets
- Free-plan limits

## 2. Citation landscape

| Source | Role |
|---|---|
| reviewhub.example | Cited in every snapshot |
| saas-compare.example | Cited in every snapshot |
| startup-forum.example | Rotates in and out |

## 3. Recommended page

Write a comparison that covers the stable core briefly, then answers the volatile questions better than any current source: free-plan limits, and moving off spreadsheets.

### Outline
1. The short answer: which tool fits which team
2. Pricing per user, side by side
3. Free-plan limits, tested
4. Moving from spreadsheets in one afternoon
5. FAQ
"""


def _reference(domain: str) -> dict:
    return {"url": f"https://{domain}/guide", "domain": domain, "source": domain.split(".")[0], "title": SITES[domain], "text": SITES[domain]}


def _answer(rng: random.Random, name_own: bool) -> AIOResult:
    edge = rng.sample(EDGE, rng.randint(3, 5))
    sources = CORE + edge
    cite = lambda i: f" [[{i + 1}]](https://{sources[i]}/guide)"
    # Competitors reshuffle daily; the own brand is left out of some answers.
    names = rng.sample(BRANDS[:3], 3)
    if name_own:
        names.insert(rng.randint(1, 3), BRANDS[3])
    lines = [
        f"For most small teams, the strongest options are **{names[0]}** and **{names[1]}**, chosen mainly on price per user and ease of setup.{cite(0)}",
        "",
        "**What to compare**",
        "",
        f"- **Pricing:** per-user cost matters more than feature count below 20 people.{cite(1)}",
        f"- **Setup:** {names[2]} is often described as the quickest to start with.{cite(2)}",
    ]
    if len(names) > 3:
        lines.append(f"- **Alternatives:** {names[3]} is worth a look for simple task lists.{cite(3)}")
    lines.append(rng.choice([
        f"- **Free plans:** limits vary widely, so check user caps first.{cite(len(sources) - 1)}",
        f"- **Reporting:** built-in time tracking is still uneven across tools.{cite(len(sources) - 1)}",
        f"- **Migration:** most tools import spreadsheets, with mixed results.{cite(len(sources) - 1)}",
    ]))
    return AIOResult(True, "\n".join(lines), [_reference(d) for d in sources], 0.0, "", {"sample": True})


def _demo_prompts(cfg):
    return [p for p in cfg.prompts if p.id.startswith("demo-")]


def seed_demo(cfg, store) -> str:
    prompts = _demo_prompts(cfg)
    if not prompts:
        return "No sample project in config.toml (prompts whose id starts with demo-)."
    if any(store.snapshots(p.id) for p in prompts):
        return "Sample data is already there."
    today = now().replace(hour=9, minute=0, second=0, microsecond=0)
    days = 12
    for i, p in enumerate(prompts):
        rng = random.Random(p.id)
        for d in range(days, 0, -1):
            name_own = (d + i) % 3 != 0  # named in two of three answers, so the sample shows both cases
            store.add_snapshot(p, cfg.source, _answer(rng, name_own), fetched_at=today - timedelta(days=d - 1))
    first = prompts[0]
    store.add_brief(
        prompt_id=first.id, created_at=iso(today), window_from=iso(today - timedelta(days=6)), window_to=iso(today),
        snapshot_count=7, model="sample", path="briefs/sample-brief.md", markdown=BRIEF, input_tokens=0, output_tokens=0,
    )
    return f"Added fictional data for {len(prompts)} sample prompts."


def clear_demo(cfg, store) -> str:
    ids = [p.id for p in _demo_prompts(cfg)]
    for pid in ids:
        store.db.execute("DELETE FROM snapshots WHERE prompt_id = ?", (pid,))
        store.db.execute("DELETE FROM briefs WHERE prompt_id = ?", (pid,))
    store.db.commit()
    doc = tomlkit.parse(CONFIG.read_text())
    for key, keep in (
        ("prompts", lambda x: not x["id"].startswith("demo-")),
        ("projects", lambda x: x["id"] != "demo"),
        ("brands", lambda x: list(x.get("projects", [])) != ["demo"]),
    ):
        if key in doc:
            kept = [x for x in doc[key] if keep(x)]
            del doc[key]
            if kept:
                doc[key] = kept
    CONFIG.write_text(tomlkit.dumps(doc))
    return f"Removed the sample project and its data ({len(ids)} prompts)."
