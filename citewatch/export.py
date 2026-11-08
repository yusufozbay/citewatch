"""Turn a brief's Markdown into downloadable files: Word, PDF, HTML, Markdown and plain text.

The Markdown is parsed as CommonMark + tables (markdown-it-py), the same dialect the UI renders,
so 2-space nested lists and pipe tables come out the same as on screen.
"""

from __future__ import annotations

import html as htmllib
import io
import re
from html.parser import HTMLParser
from pathlib import Path

from markdown_it import MarkdownIt

FORMATS = {
    "docx": ("Word", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "pdf": ("PDF", "application/pdf"),
    "html": ("HTML", "text/html; charset=utf-8"),
    "md": ("Markdown", "text/markdown; charset=utf-8"),
    "txt": ("Plain text", "text/plain; charset=utf-8"),
}

_md = MarkdownIt("commonmark", {"html": False}).enable(["table", "strikethrough"])


def clean_markdown(markdown: str) -> str:
    """Drop the leading <!-- prompt: … --> metadata comment, as the UI does."""
    return re.sub(r"^<!--.*?-->\s*", "", markdown, flags=re.S).strip() + "\n"


def to_html_fragment(markdown: str) -> str:
    return _md.render(clean_markdown(markdown))


def title_of(markdown: str, fallback: str) -> str:
    m = re.search(r"^#\s+(.+)$", clean_markdown(markdown), flags=re.M)
    return re.sub(r"[*_`]", "", m[1]).strip() if m else fallback


def export(markdown: str, fmt: str, title: str) -> bytes:
    if fmt == "md":
        return clean_markdown(markdown).encode()
    if fmt == "txt":
        return to_text(to_html_fragment(markdown)).encode()
    if fmt == "html":
        return to_html_document(to_html_fragment(markdown), title).encode()
    if fmt == "docx":
        return to_docx(to_html_fragment(markdown), title)
    if fmt == "pdf":
        return to_pdf(to_html_fragment(markdown), title)
    raise ValueError(f"unknown format {fmt!r}")


# ------------------------------------------------------------------ HTML

CSS = """
body { font: 15px/1.6 -apple-system, "Segoe UI", Arial, sans-serif; color: #1a1a1a; max-width: 820px; margin: 40px auto; padding: 0 20px; }
h1 { font-size: 1.9em; line-height: 1.25; } h2 { margin-top: 2em; border-bottom: 1px solid #e5e5e5; padding-bottom: .3em; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .92em; }
th, td { border: 1px solid #d9d9d9; padding: 6px 10px; text-align: left; vertical-align: top; } th { background: #f5f5f5; }
pre { background: #f6f6f6; padding: 12px 14px; border-radius: 6px; overflow-x: auto; font-size: .85em; line-height: 1.4; }
code { font-family: Menlo, Consolas, monospace; } :not(pre) > code { background: #f2f2f2; padding: 1px 4px; border-radius: 3px; }
blockquote { margin: 1em 0; padding: .2em 1em; border-left: 3px solid #d0d0d0; color: #555; }
hr { border: 0; border-top: 1px solid #e5e5e5; margin: 2em 0; }
"""


def to_html_document(fragment: str, title: str) -> str:
    return (
        f'<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{htmllib.escape(title)}</title><style>{CSS}</style></head>\n<body>\n{fragment}</body></html>\n"
    )


# ------------------------------------------------------------- HTML walk

BLOCKS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre", "blockquote", "table", "tr", "hr", "ul", "ol"}


class _Walker(HTMLParser):
    """Minimal event walker over markdown-it's (well-formed, predictable) HTML."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []
        self.href: str | None = None

    def handle_starttag(self, tag, attrs):
        self.stack.append(tag)
        if tag == "a":
            self.href = dict(attrs).get("href")
        self.start(tag, dict(attrs))
        if tag in ("hr", "br", "img"):
            self.stack.pop()

    def handle_endtag(self, tag):
        if tag in self.stack:
            while self.stack and self.stack.pop() != tag:
                pass
        if tag == "a":
            self.href = None
        self.end(tag)

    def handle_data(self, data):
        self.text(data)

    def inside(self, *tags) -> bool:
        return any(t in self.stack for t in tags)

    def list_depth(self) -> int:
        return sum(t in ("ul", "ol") for t in self.stack)

    def start(self, tag, attrs): ...
    def end(self, tag): ...
    def text(self, data): ...


# ----------------------------------------------------------------- text


class _Text(_Walker):
    def __init__(self):
        super().__init__()
        self.out: list[str] = []
        self.line = ""
        self.counters: list[int | None] = []
        self.row: list[str] | None = None
        self.cell: str | None = None
        self.rows: list[list[str]] = []

    def flush(self, blank=False):
        if self.line.strip():
            self.out.append(self.line.rstrip())
        self.line = ""
        if blank and self.out and self.out[-1] != "":
            self.out.append("")

    def start(self, tag, attrs):
        if tag in ("ul", "ol"):
            self.flush(blank=not self.counters)
            self.counters.append(int(attrs.get("start") or 1) if tag == "ol" else None)
        elif tag == "li":
            self.flush()
            n = self.counters[-1] if self.counters else None
            self.line = "  " * (len(self.counters) - 1) + (f"{n}. " if n is not None else "- ")
            if n is not None:
                self.counters[-1] = n + 1
        elif tag in ("p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"):
            if not self.inside("li"):
                self.flush(blank=True)
        elif tag == "table":
            self.flush(blank=True)
            self.rows = []
        elif tag == "tr":
            self.row = []
        elif tag in ("td", "th"):
            self.cell = ""
        elif tag == "hr":
            self.flush(blank=True)
            self.out += ["-" * 40, ""]
        elif tag == "br":
            self.flush()

    def end(self, tag):
        if tag in ("h1", "h2"):
            title = self.line.strip()
            self.flush()
            self.out.append(("=" if tag == "h1" else "-") * min(len(title), 80))
            self.out.append("")
        elif tag in ("p", "h3", "h4", "h5", "h6", "pre", "blockquote"):
            self.flush(blank=not self.inside("li"))
        elif tag in ("ul", "ol"):
            self.flush()
            self.counters.pop()
            if not self.counters:
                self.out.append("")
        elif tag in ("td", "th") and self.row is not None:
            self.row.append(" ".join((self.cell or "").split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None
        elif tag == "table":
            widths = [max(len(r[i]) for r in self.rows if i < len(r)) for i in range(max(map(len, self.rows), default=0))]
            for i, r in enumerate(self.rows):
                self.out.append(" | ".join(c.ljust(widths[j]) for j, c in enumerate(r)).rstrip())
                if i == 0:
                    self.out.append("-+-".join("-" * w for w in widths))
            self.out.append("")

    def text(self, data):
        if self.cell is not None:
            self.cell += data
        elif self.inside("pre"):
            lines = data.rstrip("\n").split("\n")
            prefix = "    "
            self.out += [prefix + l for l in lines]
        else:
            if self.inside("blockquote") and not self.line:
                self.line = "> "
            self.line += data.replace("\n", " ")
            if self.href and self.href != data and self.href.startswith("http"):
                self.line += f" ({self.href})"


def to_text(fragment: str) -> str:
    t = _Text()
    t.feed(fragment)
    t.flush()
    return re.sub(r"\n{3,}", "\n\n", "\n".join(t.out)).strip() + "\n"


# ----------------------------------------------------------------- Word


class _Docx(_Walker):
    def __init__(self, doc):
        super().__init__()
        from docx.shared import Pt, RGBColor

        self.Pt, self.RGB = Pt, RGBColor
        self.doc = doc
        self.para = None
        self.table = None
        self.row_cells: list[str] = []
        self.rows: list[tuple[list, bool]] = []
        self.cell_para = None

    def _style(self, name):
        try:
            return self.doc.styles[name]
        except KeyError:
            return None

    def start(self, tag, attrs):
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.para = self.doc.add_heading(level=min(int(tag[1]) - 1 or 0, 4) if tag != "h1" else 0)
        elif tag == "p":
            if self.inside("li") and self.para is not None and not self.para.text:
                return  # tight-list paragraph: keep writing into the bullet
            if self.inside("td", "th"):
                return
            style = "Quote" if self.inside("blockquote") else None
            self.para = self.doc.add_paragraph(style=style if style and self._style(style) else None)
        elif tag == "li":
            depth = self.list_depth()
            kind = "List Number" if self.stack[-2:-1] == ["ol"] else "List Bullet"
            name = kind if depth == 1 else f"{kind} {min(depth, 3)}"
            self.para = self.doc.add_paragraph(style=name if self._style(name) else kind)
        elif tag == "pre":
            self.para = self.doc.add_paragraph()
            self.para.paragraph_format.space_after = self.Pt(6)
        elif tag == "table":
            self.rows = []
        elif tag == "tr":
            self.row_cells = []
        elif tag in ("td", "th"):
            self.row_cells.append([])  # list of (text, bold, italic, code) runs
        elif tag == "hr":
            self.doc.add_paragraph("―" * 20).alignment = 1
        elif tag == "br" and self.para is not None:
            self.para.add_run().add_break()

    def end(self, tag):
        if tag == "tr":
            self.rows.append((self.row_cells, self.inside("thead")))
        elif tag == "table" and self.rows:
            cols = max(len(r) for r, _ in self.rows)
            table = self.doc.add_table(rows=len(self.rows), cols=cols)
            if self._style("Table Grid"):
                table.style = self._style("Table Grid")
            for i, (cells, head) in enumerate(self.rows):
                for j, runs in enumerate(cells):
                    p = table.cell(i, j).paragraphs[0]
                    for text, bold, italic, code in runs:
                        r = p.add_run(text)
                        r.bold = bold or head or i == 0
                        r.italic = italic
                        r.font.size = self.Pt(9.5)
                        if code:
                            r.font.name = "Courier New"
            self.doc.add_paragraph()
        elif tag in ("p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre"):
            if tag != "p" or not self.inside("li"):
                self.para = None

    def text(self, data):
        bold = self.inside("strong", "b", "th")
        italic = self.inside("em", "i")
        code = self.inside("code")
        if self.inside("td", "th") and self.row_cells:
            self.row_cells[-1].append((" ".join(data.split()) if data.strip() else data, bold, italic, code))
            return
        if self.inside("pre"):
            for i, line in enumerate(data.rstrip("\n").split("\n")):
                r = self.para.add_run(line)
                r.font.name = "Courier New"
                r.font.size = self.Pt(8.5)
                if i < data.rstrip("\n").count("\n"):
                    r.add_break()
            return
        if self.para is None:
            if not data.strip():
                return
            self.para = self.doc.add_paragraph()
        if self.href and self.href.startswith("http"):
            _add_hyperlink(self.para, self.href, data)
            return
        r = self.para.add_run(data.replace("\n", " "))
        r.bold, r.italic = bold or None, italic or None
        if code:
            r.font.name = "Courier New"
            r.font.color.rgb = self.RGB(0x80, 0x20, 0x20)


def _add_hyperlink(paragraph, url: str, text: str) -> None:
    from docx.opc.constants import RELATIONSHIP_TYPE
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    rid = paragraph.part.relate_to(url, RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), rid)
    run = OxmlElement("w:r")
    props = OxmlElement("w:rPr")
    color = OxmlElement("w:color")
    color.set(qn("w:val"), "1F5FBF")
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    props.append(color)
    props.append(underline)
    run.append(props)
    t = OxmlElement("w:t")
    t.text = text
    t.set(qn("xml:space"), "preserve")
    run.append(t)
    link.append(run)
    paragraph._p.append(link)


def to_docx(fragment: str, title: str) -> bytes:
    from docx import Document
    from docx.shared import Pt

    doc = Document()
    doc.core_properties.title = title
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)
    w = _Docx(doc)
    w.feed(fragment)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ------------------------------------------------------------------ PDF

FONT_DIR = Path(__file__).parent / "fonts"  # DejaVu: covers Turkish, box-drawing characters and arrows
FONTS = {
    "DejaVu Sans": {"": "DejaVuSans.ttf", "B": "DejaVuSans-Bold.ttf", "I": "DejaVuSans-Oblique.ttf", "BI": "DejaVuSans-BoldOblique.ttf"},
    "DejaVu Mono": {"": "DejaVuSansMono.ttf", "B": "DejaVuSansMono-Bold.ttf", "I": "DejaVuSansMono-Oblique.ttf", "BI": "DejaVuSansMono-BoldOblique.ttf"},
}


def to_pdf(fragment: str, title: str) -> bytes:
    from fpdf import FPDF
    from fpdf.fonts import FontFace

    pdf = FPDF(format="A4")
    pdf.set_title(title)
    pdf.set_margins(18, 18, 18)
    pdf.set_auto_page_break(True, margin=18)
    for family, styles in FONTS.items():
        for style, file in styles.items():
            pdf.add_font(family, style, str(FONT_DIR / file))
    body, mono = "DejaVu Sans", "DejaVu Mono"
    pdf.add_page()
    pdf.set_font(body, size=9.5)
    fragment = fragment.replace("<table>", '<table width="100%">')
    # fpdf2 only allows bold inside table cells: drop other inline tags there (code, em, links), keep the text.
    fragment = re.sub(
        r"(<t[dh](?:\s[^>]*)?>)(.*?)(</t[dh]>)",
        lambda m: m[1] + re.sub(r"</?(?!strong\b|b\b)[a-z][^>]*>", "", m[2]) + m[3],
        fragment,
        flags=re.S,
    )
    pdf.write_html(
        fragment,
        font_family=body,
        pre_code_font=mono,
        tag_styles={
            "h1": FontFace(color="#111111", size_pt=20, emphasis="BOLD"),
            "h2": FontFace(color="#111111", size_pt=15, emphasis="BOLD"),
            "h3": FontFace(color="#222222", size_pt=12.5, emphasis="BOLD"),
            "h4": FontFace(color="#333333", size_pt=11, emphasis="BOLD"),
            "code": FontFace(family=mono, color="#333333"),
            "pre": FontFace(family=mono, size_pt=8),
            "a": FontFace(color="#1F5FBF", emphasis="UNDERLINE"),
        },
        table_line_separators=True,
        li_prefix_color="#555555",
    )
    return bytes(pdf.output())
