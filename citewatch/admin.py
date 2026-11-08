"""Config and data changes made from the UI or CLI: projects, prompts and deletions."""

from __future__ import annotations

import os
import re
import shutil
import sqlite3
import unicodedata
from pathlib import Path

import tomlkit

from .config import ROOT, Config

CONFIRM_WORD = "DELETE"


class NotFound(KeyError):
    pass


class Invalid(ValueError):
    pass


CONFIG = ROOT / "config.toml"
TR_ASCII = str.maketrans("çğıİöşüÇĞÖŞÜ", "cgiIosuCGOSU")


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.translate(TR_ASCII)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "item"


def _unique(base: str, taken: set[str]) -> str:
    slug, n = base, 2
    while slug in taken:
        slug, n = f"{base}-{n}", n + 1
    return slug


def _load(path: Path):
    return tomlkit.parse(path.read_text())


def _save(doc, path: Path) -> None:
    """Back up config.toml, then replace it atomically so the hourly job never reads a half-written file."""
    shutil.copy2(path, path.with_suffix(".toml.bak"))
    tmp = path.with_suffix(".toml.tmp")
    tmp.write_text(tomlkit.dumps(doc))
    os.replace(tmp, path)


def _aot(doc, key: str):
    if key not in doc:
        doc[key] = tomlkit.aot()
    return doc[key]


def split_names(text: str | None) -> tuple[str, list[str]]:
    """'Acme, Acme Inc' -> ('Acme', ['Acme Inc']): first is the name, rest are spellings."""
    parts = [" ".join(p.split()) for p in (text or "").split(",")]
    parts = [p for p in parts if p]
    return (parts[0], parts[1:]) if parts else ("", [])


def _clean_domain(domain: str | None) -> str:
    d = (domain or "").strip().lower().removeprefix("https://").removeprefix("http://")
    return d.split("/")[0].removeprefix("www.")


def create_project(
    name: str,
    location_code: int | None = None,
    language_code: str | None = None,
    device: str | None = None,
    brief_language: str | None = None,
    own_brand: str | None = None,
    own_domain: str | None = None,
    path: Path = CONFIG,
) -> dict:
    name = (name or "").strip()
    if not name:
        raise Invalid("project name is required")
    doc = _load(path)
    projects = _aot(doc, "projects")
    pid = _unique(slugify(name), {str(p["id"]) for p in projects} | {"general"})

    t = tomlkit.table()
    t["id"] = pid
    t["name"] = name
    for key, value in (("location_code", location_code), ("language_code", language_code),
                       ("device", device), ("brief_language", brief_language)):
        if value not in (None, ""):
            t[key] = value
    own_brand, own_aliases = split_names(own_brand)
    own_domain = _clean_domain(own_domain)
    if own_brand:
        t["brand"] = f"{own_brand} ({own_domain})" if own_domain else own_brand
    projects.append(t)

    if own_brand:
        b = tomlkit.table()
        b["name"] = own_brand
        if own_aliases:
            b["aliases"] = own_aliases
        if own_domain:
            b["domains"] = [own_domain]
        b["own"] = True
        b["projects"] = [pid]
        _aot(doc, "brands").append(b)

    _save(doc, path)
    return {"id": pid, "name": name}


def add_prompt(keyword: str, project_id: str, path: Path = CONFIG) -> dict:
    keyword = " ".join((keyword or "").split())
    if not keyword:
        raise Invalid("keyword is required")
    if len(keyword) > 700:
        raise Invalid("keyword is longer than 700 characters (DataForSEO limit)")
    doc = _load(path)
    if not _project_exists(doc, project_id):
        raise NotFound(project_id)
    prompts = _aot(doc, "prompts")
    if any(str(p.get("keyword", "")).casefold() == keyword.casefold() and p.get("project", "general") == project_id
           for p in prompts):
        raise Invalid("this project already tracks that prompt")
    pid = _unique(slugify(keyword), {str(p["id"]) for p in prompts})
    t = tomlkit.table()
    t["id"] = pid
    t["keyword"] = keyword
    t["project"] = project_id
    prompts.append(t)
    _save(doc, path)
    return {"id": pid, "keyword": keyword, "project": project_id}


def _project_exists(doc, project_id: str) -> bool:
    return project_id == "general" or any(p["id"] == project_id for p in doc.get("projects", []))


def add_brand(project_id: str, names: str, domain: str | None = None, path: Path = CONFIG) -> dict:
    """Track a competitor in one project. `names` may list spellings: 'Acme Inc, Acme'."""
    name, aliases = split_names(names)
    if not name:
        raise Invalid("brand name is required")
    doc = _load(path)
    if not _project_exists(doc, project_id):
        raise NotFound(project_id)
    brands = _aot(doc, "brands")
    folded = name.casefold()
    for b in brands:
        if str(b["name"]).casefold() == folded:
            scope = b.get("projects")
            if not scope and not b.get("prompts"):
                raise Invalid(f"{name} is already tracked in every project")
            if scope is None:
                b["projects"] = scope = tomlkit.array()
            if project_id in scope:
                raise Invalid(f"{name} is already tracked in this project")
            scope.append(project_id)  # same brand, now shared with this project
            _save(doc, path)
            return {"name": str(b["name"]), "project": project_id, "shared": True}
    t = tomlkit.table()
    t["name"] = name
    if aliases:
        t["aliases"] = aliases
    if _clean_domain(domain):
        t["domains"] = [_clean_domain(domain)]
    t["projects"] = [project_id]
    brands.append(t)
    _save(doc, path)
    return {"name": name, "project": project_id, "shared": False}


def remove_brand(project_id: str, name: str, path: Path = CONFIG) -> dict:
    """Stop tracking a brand in one project; it is deleted when no other project uses it."""
    doc = _load(path)
    brands = doc.get("brands", [])
    for i, b in enumerate(brands):
        scope = b.get("projects")
        if str(b["name"]) != name or scope is None or project_id not in scope:
            continue
        if b.get("own"):
            raise Invalid("your own brand can't be removed here; edit config.toml")
        scope.remove(project_id)
        deleted = len(scope) == 0 and not b.get("prompts")
        if deleted:
            del brands[i]
        _save(doc, path)
        return {"name": name, "project": project_id, "deleted": deleted}
    raise NotFound(name)


def move_prompt(prompt_id: str, project_id: str, path: Path = CONFIG) -> dict:
    doc = _load(path)
    if project_id != "general" and not any(p["id"] == project_id for p in doc.get("projects", [])):
        raise NotFound(project_id)
    prompt = next((p for p in doc.get("prompts", []) if p.get("id") == prompt_id), None)
    if prompt is None:
        raise NotFound(prompt_id)
    prompt["project"] = project_id
    _save(doc, path)
    return {"id": prompt_id, "project": project_id}


def delete_prompt(cfg: Config, prompt_id: str, config_path: Path = CONFIG) -> dict:
    """Remove a prompt from config.toml and delete its snapshots and briefs from the database.

    Brands scoped only to this prompt are removed too (an empty `prompts` list would otherwise
    widen them to every prompt). config.toml is backed up to config.toml.bak first.
    Brief Markdown files in briefs/ are left on disk.
    """
    doc = tomlkit.parse(config_path.read_text())
    prompts = doc.get("prompts", [])
    index = next((i for i, p in enumerate(prompts) if p.get("id") == prompt_id), None)
    if index is None:
        raise NotFound(prompt_id)
    keyword = str(prompts[index].get("keyword", ""))
    del prompts[index]

    removed_brands, unscoped = [], []
    brands = doc.get("brands", [])
    for i in reversed(range(len(brands))):
        scope = brands[i].get("prompts")
        if scope is None or prompt_id not in scope:
            continue
        scope.remove(prompt_id)
        if len(scope) == 0:
            removed_brands.append(str(brands[i]["name"]))
            del brands[i]
        else:
            unscoped.append(str(brands[i]["name"]))

    _save(doc, config_path)

    con = sqlite3.connect(cfg.db_path)
    with con:
        snaps = con.execute("DELETE FROM snapshots WHERE prompt_id = ?", (prompt_id,)).rowcount
        briefs = con.execute("DELETE FROM briefs WHERE prompt_id = ?", (prompt_id,)).rowcount
    con.close()

    kept_files = sorted(p.name for p in cfg.briefs_dir.glob(f"*_{prompt_id}.md")) if cfg.briefs_dir.exists() else []
    return {
        "id": prompt_id,
        "keyword": keyword,
        "snapshots_deleted": snaps,
        "briefs_deleted": briefs,
        "brands_removed": sorted(removed_brands),
        "brands_updated": sorted(unscoped),
        "brief_files_kept": kept_files,
        "config_backup": "config.toml.bak",
    }
