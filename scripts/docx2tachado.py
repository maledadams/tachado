#!/usr/bin/env python3
"""Convert a Word documentation log into a Tachado month note.

Maps Word's outline styles onto Tachado's heading skeleton, keeps hyperlinks,
turns the green inline-code colour into backticks, and leaves the TO-DO report
sections empty so Tachado regenerates them from the body on first open.

    python3 scripts/docx2tachado.py "log.docx" --year 2026 --out ~/vault
    python3 scripts/docx2tachado.py "log.docx" --tools Remargin WispBridge

Standard library only. No pandoc, no python-docx.
"""

import argparse
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
          "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]

CODE_COLOR = "188038"        # Google Docs' green, used for inline code
IS_REPORT = re.compile(r"TO-?DO", re.I)
IS_MONTHLY = re.compile(r"(END OF )?MONTH", re.I)


def rels(zf):
    """id -> target, for hyperlinks."""
    out = {}
    try:
        root = ET.fromstring(zf.read("word/_rels/document.xml.rels"))
    except KeyError:
        return out
    for rel in root:
        out[rel.get("Id")] = rel.get("Target")
    return out


def run_text(run):
    """Text of one run, plus the formatting we care about."""
    parts = []
    for node in run.iter():
        if node.tag == W + "t":
            parts.append(node.text or "")
        elif node.tag in (W + "tab",):
            parts.append(" ")
        elif node.tag in (W + "br", W + "cr"):
            parts.append(" ")
    props = run.find(W + "rPr")
    color = ""
    if props is not None:
        node = props.find(W + "color")
        if node is not None:
            color = (node.get(W + "val") or "").lower()
    return "".join(parts), color


def para_text(para, link_map, tools):
    """Render one paragraph to markdown, merging runs that share formatting."""
    chunks = []          # (text, is_code, href)

    def walk(parent, href=None):
        for child in parent:
            if child.tag == W + "hyperlink":
                target = link_map.get(child.get(R + "id"))
                walk(child, target or href)
            elif child.tag == W + "r":
                text, color = run_text(child)
                if text:
                    chunks.append((text, color == CODE_COLOR, href))

    walk(para)

    # merge neighbours with identical formatting so we don't emit `a``b`
    merged = []
    for text, code, href in chunks:
        if merged and merged[-1][1] == code and merged[-1][2] == href:
            merged[-1][0] += text
        else:
            merged.append([text, code, href])

    out = []
    for text, code, href in merged:
        core = text.strip()
        if not core:
            out.append(text)
            continue
        lead = text[:len(text) - len(text.lstrip())]
        trail = text[len(text.rstrip()):]
        if code:
            core = "`" + core + "`"
        if href:
            match = next((t for t in tools if t.lower() == core.lower()), None)
            if match:
                core = f"[[{match}]]" if core == match else f"[[{match}|{core}]]"
            else:
                core = f"[{core}]({href})"
        out.append(lead + core + trail)

    return re.sub(r"[ \t]+", " ", "".join(out)).strip()


def style_of(para):
    props = para.find(W + "pPr")
    if props is None:
        return ""
    node = props.find(W + "pStyle")
    return (node.get(W + "val") if node is not None else "") or ""


def heading_level(style, text):
    """Word style -> number of '#'. 0 means body text."""
    if style == "Title":
        return 1
    if style == "Heading1":
        return 1 if IS_MONTHLY.search(text) and IS_REPORT.search(text) else 2
    if style == "Heading2":
        return 2
    if style == "Heading3":
        return 3
    if style.startswith("Heading"):
        return 4
    return 0


def convert(path, tools):
    with zipfile.ZipFile(path) as zf:
        link_map = rels(zf)
        body = ET.fromstring(zf.read("word/document.xml")).find(W + "body")

    lines = []
    in_report = False
    month = year = None

    for para in body.findall(W + "p"):
        style = style_of(para)
        text = para_text(para, link_map, tools)
        level = heading_level(style, text)

        if level:
            in_report = bool(IS_REPORT.search(text))
            lines += ["", "#" * level + " " + text, ""]
            if month is None:
                found = next((m for m in MONTHS if m in text.upper()), None)
                if found:
                    month = found
            if year is None:
                found = re.search(r"\b(20\d\d)\b", text)
                if found:
                    year = found.group(1)
            continue

        if in_report or not text:
            continue          # Tachado regenerates every report body
        lines.append(text)

    md = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip() + "\n"
    return md, month, year


def main():
    ap = argparse.ArgumentParser(description="Convert a Word log into a Tachado month note.")
    ap.add_argument("docx")
    ap.add_argument("--out", default=".", help="vault root (default: current directory)")
    ap.add_argument("--year", help="override the year detected in the document")
    ap.add_argument("--month", help="override the month detected in the document")
    ap.add_argument("--tools", nargs="*", default=[], help="tool names to link as wikilinks")
    ap.add_argument("--stdout", action="store_true", help="print instead of writing")
    args = ap.parse_args()

    md, month, year = convert(args.docx, args.tools)
    month = (args.month or month or "").upper()
    year = args.year or year
    if not month or not year:
        sys.exit("Could not detect month/year. Pass --month and --year.")

    md = f"# {month} {year}\n\n{md.lstrip()}"
    if args.stdout:
        print(md)
        return

    folder = os.path.join(args.out, year)
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, f"{month} {year}.md")
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write(md)
    print(f"wrote {dest}")
    print("Open it in Obsidian with Tachado enabled to generate the reports and index.")


if __name__ == "__main__":
    main()
