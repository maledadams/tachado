<div align="center">

# Tachado

### Colored task tracking and automatic carry-over for Obsidian daily documentation

**Write your work log as it happens. Let the plugin do the bookkeeping.**

[![Obsidian](https://img.shields.io/badge/Obsidian-plugin-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-1B7F4C.svg)](LICENSE)
[![No build step](https://img.shields.io/badge/build-none%20required-0A7EA4)](#development)
[![Tests](https://img.shields.io/badge/self--check-42%20passing-1B7F4C)](check.js)

</div>

---

## What it does

Tachado turns plain-text markers like `1.D`, `2.W` and `3.M` in your notes into **live-colored, italicized tasks** — and then keeps your daily, weekly and monthly TO-DO reports in sync automatically.

You write the log. Tachado handles numbering, carry-over, promotion, strikethrough and report generation.

```markdown
3:45 p.m. : 2.D so I need a branch-specific bd until [[remargin]] has a task manager
3:50 p.m. : 3.D reescribir la solución de [[WispBridge]] lista para producción
```

Open the note tomorrow and the report has already updated itself:

```markdown
### Daily TO-DO Report

- [ ] 0.1.D — so I need a branch-specific bd until [[remargin]] has a task manager
- [x] 1.D — ~~reescribir la solución de [[WispBridge]] lista para producción~~
```

### The colors live in the plugin, not in your files

Your markdown stays **plain text**. No `<span style="color:red">`, no HTML pollution, no proprietary format.

```markdown
2.D so I need a branch-specific bd
```

That's what's on disk. Greppable, diffable, portable, yours. The red-italic rendering is a CodeMirror decoration applied at display time — in both Live Preview and Reading view.

---

## Features

| | |
|---|---|
| 🎨 **Live coloring** | `D` red, `W` orange, `M` blue — token and task text, italic, as you type |
| ♻️ **Automatic carry-over** | Unfinished daily tasks reappear tomorrow as `0.1.D`, `0.2.D`… with no action from you |
| 🔢 **Self-renumbering** | Carry-over slots are positional, always oldest-first. Insert an older task and everything below it shifts down |
| ⬆️ **Promotion & demotion** | Rewrite the suffix to move a task between timeframes. Up = plain number, down = carry namespace |
| ✅ **Generated reports** | Daily, weekly and monthly TO-DO sections are rebuilt from your log, never typed by hand |
| ~~🚫~~ **Strikethrough & DROPPED** | Native Obsidian checkboxes. `- [x]` strikes it, `- [-]` marks it `[DROPPED]` |
| 🔗 **Automatic tool linking** | Mention a tool that exists in `Tools/` and it becomes a real wikilink — backlinks and graph included |
| ⌨️ **`@` tool picker** | Type `@` for a dropdown of your tools, or keep typing to create a new tool note on the spot |
| 🗂️ **Generated indexes** | A year note with live per-month counts, and a collapsible index inside every month |
| 📄 **One note per month** | `2026/SEPTEMBER 2026.md` holds every week, day and report. No file sprawl |
| 📦 **Zero dependencies** | ~450 lines of plain JavaScript. No npm, no bundler, no build step |

---

## Install

Tachado isn't in the community plugin directory yet. Install it manually:

```bash
git clone https://github.com/maledadams/tachado.git "<your-vault>/.obsidian/plugins/tachado"
```

Then in Obsidian: **Settings → Community plugins →** turn off Restricted mode **→ enable Tachado**.

> Only `main.js`, `manifest.json` and `styles.css` are needed at runtime.

---

## The syntax

One regex drives everything:

```
(0.)?N.SCOPE
```

| Token | Scope | Color | Meaning |
|---|---|---|---|
| `1.D` | Daily | 🔴 red | A task for today |
| `1.W` | Weekly | 🟠 orange | A task for this week |
| `1.M` | Monthly | 🔵 blue | A task for this month |
| `0.1.D` | Carry | 🔴 red | Arrived from an earlier day, or demoted from a longer timeframe |

Write the token anywhere on a line. Each token colors itself and the text that follows it, up to the next token or the end of the line — so a single line can carry two tasks:

```markdown
3:50 p.m. : he said 3.D "rewrite the service" BUT 4.D "wait a week first"
```

### Carry-over is a sort, not a queue

The `0.N` namespace is **positional and ordered by age**. `0.1` is always the oldest open task.

Add a task older than the current `0.1` and it takes `0.1`; everything below shifts down one. Numbers belong to positions, not to tasks — which is exactly why you shouldn't be maintaining them by hand.

### Promotion and demotion

Declare a move by writing the line again later with a new suffix. Tachado links the two by text and updates the scope.

```markdown
11:00 a.m. : 1.D reventar la barrita          ← raised as a daily task
 9:00 p.m. : 2.W reventar la barrita          ← moved to weekly
```

| Direction | Result |
|---|---|
| **Promote** — `D → W`, `D → M`, `W → M` | Plain next number in the target list (`2.W`) |
| **Demote** — `M → W`, `M → D`, `W → D` | Carry namespace (`0.1.D`), arriving on the day you demoted it |
| **Unfinished daily** → next day | Carry namespace (`0.1.D`) |

---

## Vault structure

Year folders, one note per month, and a `Tools/` folder for everything you link to.

```
your-vault/
├── 2026/
│   ├── 2026 Index.md          ← generated
│   ├── SEPTEMBER 2026.md
│   └── OCTOBER 2026.md
├── 2027/
│   └── 2027 Index.md          ← generated
└── Tools/
    ├── Figma.md
    └── Postgres.md
```

Inside a month note, headings define the skeleton. The TO-DO headings are the only markers Tachado needs — it owns everything between a report heading and the next heading.

```markdown
# SEPTEMBER 2026

%% tachado:index %%            ← generated, invisible in Reading view
> [!abstract]- Index
> Year · [[2026 Index|2026]]
> **Weeks** · [[#WEEK 1 OF SEPTEMBER|Week 1]]
> **Days** · [[#Mon, September, 7:|Mon 7]] · [[#Tue, September, 8:|Tue 8]]
%% /tachado:index %%

# WEEK 1 OF SEPTEMBER           ← week banner

## Mon, September, 7:           ← day
9:30 a.m. : kicked off the sprint
11:00 a.m. : 1.D write the migration

### Daily TO-DO Report          ← generated

## END OF WEEK 1 TO-DO REPORT   ← generated

# END OF SEPTEMBER TO-DO REPORT ← generated
```

See [`example/`](example/) for a full worked month, its year index and two tool notes.

---

## Tools and automatic linking

Every tool, service or project you reference is **its own note** in `Tools/`. Mention one anywhere in your log and Tachado turns it into a real wikilink, so backlinks and the graph view actually work.

```markdown
11:00 a.m. : 1.D write the migration in postgres
                                        ↓
11:00 a.m. : 1.D write the migration in [[Postgres|postgres]]
```

Your original casing is preserved through the alias. Frontmatter `aliases` are matched too, so `psql` and `postgresql` both resolve to the same note.

### The `@` picker

Type `@` anywhere to get a dropdown of every tool in `Tools/`. Keep typing to filter. If the name doesn't exist yet, the last option creates `Tools/<name>.md` from a template and links it in one keystroke.

Linking is deliberately conservative — it skips inline code, URLs, markdown links, existing wikilinks, blockquotes, generated report rows, and anything shorter than three characters.

---

## Indexes

| Index | Where | Contents |
|---|---|---|
| **Year** | `2026/2026 Index.md` | Every month in that year, with live open / done / dropped counts and totals |
| **Month** | Top of each month note | Collapsible callout linking back to the year, plus every week and day in the note |

Both regenerate whenever you open a month note. The month index lives inside an Obsidian comment block, so it's invisible in Reading view and never clutters your writing.

---

## Commands

| Command | What it does |
|---|---|
| **Rebuild TO-DO reports and index** | Reparses the note, relinks tools, regenerates every report and the index |
| **Rebuild year index** | Recounts every month in the current year folder |
| **New tool note** | Drops an `@` at the cursor to open the tool picker |

All of it also runs automatically whenever you open a month note — so carry-over, linking and indexes just happen.

---

## Customizing colors

Edit `styles.css`. Three variables, light and dark:

```css
.theme-light { --tl-D:#ff0000; --tl-W:#ff9900; --tl-M:#4a86e8; }
.theme-dark  { --tl-D:#ff6b6b; --tl-W:#ffb84d; --tl-M:#7fb3f5; }
```

---

## Development

There's no build step. `main.js` is what Obsidian loads.

```bash
node check.js
```

42 assertions covering the `0.N` sort order, promotion, demotion arrival day, checkbox-state preservation, multiple tasks per line, autolinking guards, index generation and idempotence. No test framework.

### Known limitation

**A task's identity is its text.** Reword a task substantially and Tachado treats it as new, resetting its checkbox. This is a deliberate trade: it keeps hidden IDs out of your markdown. The upgrade path (Obsidian block references) is noted in `main.js`.

---

## Importing from Word

Already keeping this log in Word or Google Docs? `scripts/docx2tachado.py` converts a `.docx` export into a month note.

```bash
python3 scripts/docx2tachado.py "My log.docx" --year 2026 --out ~/my-vault \
        --tools Remargin WispBridge Dolt
```

It maps Word's outline styles onto Tachado's heading skeleton (Title → `#`, Heading 1 → `##`, Heading 3 → `###`), keeps hyperlinks, turns Google Docs' green inline-code color into backticks, and converts mentions of the tools you name into wikilinks. Report bodies are left empty on purpose — Tachado regenerates them from the log the first time you open the note.

Standard library only: no pandoc, no `python-docx`.

---

## Roadmap

- [ ] `.docx` export via Pandoc with a reference template — Arial 26 titles, Arial 20 day headings, exact task colors
- [ ] Settings tab for colors, folder names and heading levels
- [ ] Community plugin directory submission

---

## Why "Tachado"

Spanish for *struck through* — what happens to a task when you finally finish it.

---

## License

[MIT](LICENSE) © Lucia Adams
