#!/usr/bin/env python3
"""Export a Tachado month note to .docx.

The colours live in the plugin, not in the markdown, so this re-applies them:
task markers and their text come out italic and coloured, completed rows come
out struck through, and the headings get the sizes the format asks for —
Arial 26 for a week banner, Arial 20 for a day.

    python3 scripts/tachado2docx.py "2026/SEPTEMBER 2026.md"
    python3 scripts/tachado2docx.py "2026/SEPTEMBER 2026.md" -o ~/Desktop

Standard library only. No pandoc, no python-docx.
"""

import argparse
import os
import re
import zipfile

# Google Docs' palette, matching the source documents this format came from.
SCOPE = {"D": "FF0000", "W": "FF9900", "M": "4A86E8"}
LINK = "1155CC"
CODE = "188038"
MUTED = "666666"

FONT = "Arial"
SZ_TITLE, SZ_H1, SZ_H2, SZ_H3, SZ_BODY, SZ_TOK = 52, 40, 32, 28, 22, 30  # half-points

MARKER = re.compile(r"(?:(?<=\s)|^)((?:0\.)?\d+\.([DWM]))(?![\w.])")
INLINE = re.compile(r"(\[\[[^\]]+\]\]|\[[^\]]*\]\([^)]*\)|`[^`]+`|~~.+?~~|\*\*.+?\*\*)")
ROW = re.compile(r"^\s*-\s*\[([ xX-])\]\s*((?:0\.)?\d+\.([DWM]))\s*[—-]?\s*(.*)$")
BOX = {" ": "☐", "x": "☑", "X": "☑", "-": "☒"}


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def run(text, *, color=None, italic=False, bold=False, strike=False, size=SZ_BODY, mono=False):
    if not text:
        return ""
    props = [f'<w:rFonts w:ascii="{"Courier New" if mono else FONT}" '
             f'w:hAnsi="{"Courier New" if mono else FONT}"/>']
    if bold:
        props.append("<w:b/>")
    if italic:
        props.append("<w:i/>")
    if strike:
        props.append("<w:strike/>")
    if color:
        props.append(f'<w:color w:val="{color}"/>')
    props.append(f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>')
    return (f'<w:r><w:rPr>{"".join(props)}</w:rPr>'
            f'<w:t xml:space="preserve">{esc(text)}</w:t></w:r>')


def inline_runs(text, rels, color=None, italic=False, strike=False):
    """Markdown spans -> runs, keeping whatever colour the caller is applying."""
    out = []
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("[[") and part.endswith("]]"):
            label = part[2:-2].split("|")[-1]
            out.append(run(label, color=color or LINK, italic=italic, strike=strike))
        elif part.startswith("`") and part.endswith("`"):
            out.append(run(part[1:-1], color=color or CODE, italic=italic,
                           strike=strike, mono=True))
        elif part.startswith("~~") and part.endswith("~~"):
            out += inline_runs(part[2:-2], rels, color, italic, True)
        elif part.startswith("**") and part.endswith("**"):
            out.append(run(part[2:-2], color=color, italic=italic, strike=strike, bold=True))
        elif part.startswith("[") and "](" in part:
            label, url = part[1:].split("](", 1)
            rid = rels.add(url.rstrip(")"))
            out.append(f'<w:hyperlink r:id="{rid}">'
                       f'{run(label, color=color or LINK, italic=italic, strike=strike)}'
                       "</w:hyperlink>")
        else:
            out.append(run(part, color=color, italic=italic, strike=strike))
    return out


def body_runs(line, rels):
    """A log line. Each marker colours itself and the text that follows it."""
    hits = list(MARKER.finditer(line))
    if not hits:
        return inline_runs(line, rels)

    out = inline_runs(line[: hits[0].start(1)], rels)
    for i, m in enumerate(hits):
        color = SCOPE[m.group(2)]
        stop = hits[i + 1].start(1) if i + 1 < len(hits) else len(line)
        out.append(run(m.group(1), color=color, italic=True, bold=True, size=SZ_TOK))
        out += inline_runs(line[m.end(1):stop], rels, color, italic=True)
    return out


def row_runs(m, rels):
    """A generated report row: checkbox, marker, text, and any closing note."""
    box, marker, scope, rest = m.group(1), m.group(2), m.group(3), m.group(4)
    closed = box != " "
    tail = ""
    note = re.search(r"\s*(\[(?:completed|DROPPED)[^\]]*\])\s*$", rest, re.I)
    if note:
        tail = note.group(1)
        rest = rest[: note.start()]

    out = [run(BOX[box] + " ", size=SZ_TOK),
           run(marker + " ", color=SCOPE[scope], italic=True, bold=True, size=SZ_TOK)]
    out += inline_runs(rest.strip(), rels, SCOPE[scope], italic=True, strike=closed)
    if tail:
        out.append(run("  " + tail, color=MUTED, size=SZ_BODY))
    return out


def para(runs, style=None):
    props = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{props}{''.join(runs)}</w:p>"


class Rels:
    def __init__(self):
        self.items = []

    def add(self, url):
        self.items.append(url)
        return f"rId{100 + len(self.items)}"

    def xml(self):
        body = "".join(
            f'<Relationship Id="rId{100 + i}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
            f'Target="{esc(u)}" TargetMode="External"/>'
            for i, u in enumerate(self.items, 1))
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
                f'Target="styles.xml"/>{body}</Relationships>')


def style(sid, name, size, *, outline=None, bold=True, color="000000"):
    out = f'<w:outlineLvl w:val="{outline}"/>' if outline is not None else ""
    return (f'<w:style w:type="paragraph" w:styleId="{sid}">'
            f'<w:name w:val="{name}"/><w:basedOn w:val="Normal"/>'
            f'<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/>{out}</w:pPr>'
            f'<w:rPr><w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}"/>'
            f'{"<w:b/>" if bold else ""}<w:color w:val="{color}"/>'
            f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr></w:style>')


STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
          '<w:docDefaults><w:rPrDefault><w:rPr>'
          f'<w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}"/>'
          f'<w:sz w:val="{SZ_BODY}"/><w:szCs w:val="{SZ_BODY}"/>'
          '</w:rPr></w:rPrDefault></w:docDefaults>'
          '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
          '<w:name w:val="Normal"/></w:style>'
          + style("Title", "Title", SZ_TITLE)
          + style("Heading1", "heading 1", SZ_H1, outline=0)
          + style("Heading2", "heading 2", SZ_H2, outline=1)
          + style("Heading3", "heading 3", SZ_H3, outline=2)
          + "</w:styles>")

CONTENT_TYPES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                 '<Default Extension="xml" ContentType="application/xml"/>'
                 '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                 '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                 "</Types>")

ROOT_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" '
             'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
             'Target="word/document.xml"/></Relationships>')


def convert(md):
    """Markdown -> (document.xml body, rels). The index block is dropped."""
    rels = Rels()
    paras = []
    skipping = False

    for line in md.split("\n"):
        if line.strip() == "%% tachado:index %%":
            skipping = True
            continue
        if line.strip() == "%% /tachado:index %%":
            skipping = False
            continue
        if skipping or line.startswith("%%"):
            continue

        if line.startswith("### "):
            paras.append(para([run(line[4:], size=SZ_H3, bold=True)], "Heading3"))
        elif line.startswith("## "):
            head = line[3:]
            # a week or month report heading is a Heading 2; a day is a Heading 1
            sid, size = ("Heading2", SZ_H2) if re.search(r"TO-?DO", head, re.I) else ("Heading1", SZ_H1)
            paras.append(para([run(head, size=size, bold=True)], sid))
        elif line.startswith("# "):
            head = line[2:]
            sid, size = ("Heading1", SZ_H1) if re.search(r"TO-?DO", head, re.I) else ("Title", SZ_TITLE)
            paras.append(para([run(head, size=size, bold=True)], sid))
        elif not line.strip():
            continue
        else:
            m = ROW.match(line)
            paras.append(para(row_runs(m, rels) if m else body_runs(line, rels)))

    body = ("".join(paras) +
            '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
            '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f"<w:body>{body}</w:body></w:document>"), rels


def write(md, dest):
    document, rels = convert(md)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("word/document.xml", document)
        z.writestr("word/styles.xml", STYLES)
        z.writestr("word/_rels/document.xml.rels", rels.xml())
    return dest


def main():
    ap = argparse.ArgumentParser(description="Export a Tachado month note to .docx.")
    ap.add_argument("note")
    ap.add_argument("-o", "--out", help="directory to write into (default: beside the note)")
    args = ap.parse_args()

    with open(args.note, encoding="utf-8") as fh:
        md = fh.read()

    name = os.path.splitext(os.path.basename(args.note))[0] + ".docx"
    dest = os.path.join(args.out or os.path.dirname(os.path.abspath(args.note)), name)
    print(write(md, dest))


if __name__ == "__main__":
    main()
