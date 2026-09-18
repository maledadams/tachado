<div align="center">

# Tachado

### Colored task tracking and automatic carry-over for Obsidian daily documentation

**Write your work log as it happens. Let the plugin do the bookkeeping.**

[![Obsidian](https://img.shields.io/badge/Obsidian-plugin-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-1B7F4C.svg)](LICENSE)
[![No build step](https://img.shields.io/badge/build-none%20required-0A7EA4)](#development)
[![Tests](https://img.shields.io/badge/self--check-305%20passing-1B7F4C)](check.js)

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
| ✍️ **You never number anything** | Write `D :`, `W :` or `M :` and the number is filled in for you, continuing from whatever is already there |
| 🎨 **Live coloring** | `D` red, `W` orange, `M` blue — token and task text, italic, as you type |
| ♻️ **Automatic carry-over** | An unfinished task *moves* to today as `0.1.D`, `0.2.D`… once the clock reaches it — it never sits in two lists at once |
| 🔢 **Self-renumbering** | Carry-over slots are positional, always oldest-first. Insert an older task and everything below it shifts down |
| ⬆️ **Promotion & demotion** | Rewrite the suffix to move a task between timeframes. Up = plain number, down = carry namespace |
| ✅ **Generated reports** | Daily, weekly and monthly TO-DO sections are rebuilt from your log, never typed by hand |
| ~~🚫~~ **Strikethrough & DROPPED** | Native Obsidian checkboxes. `- [x]` strikes it, `- [-]` marks it `[DROPPED]` |
| 📆 **Closing dates** | Ticking or dropping records the day you did it — `[completed 17/09/2026]`, `[DROPPED 17/09/2026]` — written once and never recomputed |
| 🔗 **Automatic linking** | Mention a tool or project that exists and it becomes a real wikilink — backlinks and graph included |
| ⌨️ **`@` picker** | Type `@` for a dropdown of every tool and project, or keep typing to create a new one on the spot |
| 🐙 **GitHub import** | Commits, PRs, merges and reviews pulled in automatically as timestamped log lines, scoped to the orgs you allow |
| 🗓️ **Log to any past day** | A calendar you click a day in, then a time and what happened. Future days are not selectable |
| 📅 **Month scaffolding** | Pick a month and year; the note arrives with every day already written out and grouped into calendar weeks |
| 🕔 **5-minute clock** | Every time in the log is normalised to `9:15 a.m.`, rounded to the nearest five minutes |
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

### Just write the letter

You never work out a number yourself. Write the scope and a colon:

```markdown
9:05 a.m. : D : revisar los comments de Eduardo
9:30 a.m. : W : terminar el blueprint
```

and the next rebuild fills them in:

```markdown
9:05 a.m. : 1.D revisar los comments de Eduardo
9:30 a.m. : 2.W terminar el blueprint
```

Numbering runs per scope and per period — day for `D`, week for `W`, the note for `M` — and continues from the highest number already written there by hand. Lowercase works. Bare markers are colored live as you type, so you can see one registered before it has a number.

Written out in full, a marker is:

```
(0.)?N.SCOPE      1.D   2.W   3.M   0.1.D
SCOPE :           D :   W :   M :
```

| Token | Scope | Color | Meaning |
|---|---|---|---|
| `1.D` | Daily | 🔴 red | A task for today |
| `1.W` | Weekly | 🟠 orange | A task for this week |
| `1.M` | Monthly | 🔵 blue | A task for this month |
| `0.1.D` | Carry | 🔴 red | Arrived from an earlier day, or demoted from a longer timeframe |

Times are normalised on every rebuild: 12-hour, `a.m.`/`p.m.`, and rounded to the nearest five minutes. `9:13 a.m.` becomes `9:15 a.m.`, `11:59 p.m.` rolls to `12:00 a.m.` Inline code and URLs are left alone.

Write the token anywhere on a line. Each token colors itself and the text that follows it, up to the next token or the end of the line — so a single line can carry two tasks:

```markdown
3:50 p.m. : he said 3.D "rewrite the service" BUT 4.D "wait a week first"
```

Carry-over tracks the real clock, and it **moves** a task rather than copying it. An unfinished task appears in exactly one daily report: today's. It leaves the day it was raised on. A task you finished stays struck through on the day you closed it, and never travels.

A report for a day that hasn't arrived stays empty, even when the note already has a heading for it — scaffolding October doesn't project today's unfinished work across all thirty-one days.

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

## Logging to any day

**Add a log entry** opens a month grid. Click a day, type a time and what happened, press Enter.

```
 ‹      September 2026      ›
 Mo Tu We Th Fr Sa Su
     1  2  3  4  5  6
  7  8  9 10 11 12 13
 14 15 16 17 18 19 20
 21 22 23 24 25 26 27
 28 29 30

 [ 3:45 p.m. ] [ what happened — or 1.D a task ]
```

Future days are greyed out and unclickable, and you can't page past the current month — this is a log, not a planner.

The time box is forgiving: `3:45 p.m.`, `3:45pm`, `3pm` and `15:47` all work, and whatever you type is rounded to the nearest five minutes on the way in. Type a task token and it behaves like any other task.

If the day you pick has no heading yet, Tachado writes one — along with its week banner and that week's report — in the right place. If the whole month note doesn't exist, it gets scaffolded first.

## Putting a misplaced entry right

**Move a log entry to another day** takes two passes over the same grid: pick the day you think it's on and click the entry, then pick the day it belongs on. Days holding entries are marked, so a line that landed somewhere odd is easy to spot.

The entry keeps its time and is re-filed in time order on the destination day. If that day has no heading yet, one is written — along with its week banner, if that is missing too.

---

## Closing a task without hunting for it

**Complete a task** and **Drop a task** open the same grid. Days carrying open work are marked; click one and you get everything closeable from there — that day's tasks, that week's, and the month's, each with its number. Click a task and it's closed and dated.

```
 ‹      September 2026      ›
 Mo Tu We Th Fr Sa Su
  ...
 14 15 16 17 ...              ← days with open tasks are marked

 0.1.D   so I need a branch specific bd until remargin…
 0.2.D   "Dile que aquí el objetivo es reescribir…"
 1.W     nueva misión semanal: REVENTAR la barrita…
```

It flips the same checkbox you would click by hand, so the date lands exactly as it would otherwise. The row is matched on its text rather than its position, so editing the note while the picker is open can't close the wrong task.

### Why not the Calendar plugin?

The [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) plugin is built around **one note per day**: clicking a date calls `openOrCreateDailyNote`, and it exposes no hook to do anything else. Tachado is one note per *month* on purpose, so wiring the two together would scatter a file per day across your vault — the opposite of the point. Hence the small grid above.

---

## Starting a month

**New month note** opens a picker that works like Obsidian's quick switcher — type to filter, Enter to create.

The note arrives complete: every day of that month, with its weekday, already grouped into weeks, each with its report heading.

```markdown
# OCTOBER 2026

# WEEK 1 OF OCTOBER

## Thu, October, 1:

### Daily TO-DO Report

## Fri, October, 2:

### Daily TO-DO Report
...
## END OF WEEK 1 TO-DO REPORT

# WEEK 2 OF OCTOBER
...
# END OF OCTOBER TO-DO REPORT
```

Weeks start on Monday and are numbered within the month, so Monday 14 September 2026 falls in week 3. That means a month has **five or six weeks** as often as it has four — September 2026 has five: the 1st–6th, 7th–13th, 14th–20th, 21st–27th and 28th–30th.

Picking a month that already exists just opens it.

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
├── Tools/
│   ├── Figma.md
│   └── Postgres.md
└── Projects/
    └── Checkout Rewrite.md
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

## Tools, projects and automatic linking

Everything you reference is **its own note**. Tools live in `Tools/`, projects in `Projects/` — same machinery for both: mention one anywhere in your log and Tachado turns it into a real wikilink, so backlinks and the graph view actually work.

```markdown
11:00 a.m. : 1.D write the migration in postgres for the checkout rewrite
                                        ↓
11:00 a.m. : 1.D write the migration in [[Postgres|postgres]] for the [[Checkout Rewrite|checkout rewrite]]
```

Your original casing is preserved through the alias. Frontmatter `aliases` are matched too, so `psql` and `postgresql` both resolve to the same note.

| Kind | Folder | Frontmatter |
|---|---|---|
| **Tool** | `Tools/` | `type: tool`, `aliases`, `url` |
| **Project** | `Projects/` | `type: project`, `aliases`, `status`, `started`, `repo` |

Adding a third kind is one row in the `KINDS` array at the top of `main.js`.

### The `@` picker

Type `@` anywhere to get a dropdown of every tool and project, each labelled with its kind. Keep typing to filter. If the name doesn't exist yet, you get one create option per kind — pick **Project** or **Tool** and it writes the note from the right template and links it in one keystroke.

Linking is deliberately conservative — it skips inline code, URLs, markdown links, existing wikilinks, blockquotes, generated report rows, and anything shorter than three characters.

---

## GitHub activity

Commits, pull requests, merges and reviews land in your log as timestamped lines, linked back to the action on GitHub.

```markdown
1:45 p.m. : commit [acme/app@a9d2477](https://github.com/acme/app/commit/a9d2477…) — docs: add the structure
2:40 p.m. : PR [acme/app#5](https://github.com/acme/app/pull/5) opened — docs structure · `docs/x` → `master` · 57 files +5190 −31
4:00 p.m. : PR [acme/app#5](https://github.com/acme/app/pull/5) merged into `master`
10:15 a.m. : reviewed [acme/app#12](https://github.com/acme/app/pull/12) — approved
```

Each entry is placed under the day it happened on, in chronological order among your other timestamped lines. Prose you wrote by hand is never reordered.

Generated lines are **records, not prose**: they are never autolinked, so a commit subject like `docs(wispbridge): …` keeps the scope the commit actually has. Re-running never duplicates, because entries are matched on a signature that survives a PR's file counts changing while it is open — and a URL you merely mentioned in a sentence never blocks the real entry from arriving.

### No token, ever

Tachado shells out to the **[GitHub CLI](https://cli.github.com)**, which is already authenticated on your machine. No personal access token is stored in your vault, so nothing leaks if you sync or push it.

```bash
brew install gh && gh auth login
```

### Paste a link, get an entry

Drop a bare commit or PR URL on a line and run **Expand GitHub links**. Tachado fetches the title, stats, branches and the real timestamp, then rewrites the line as a full entry.

```markdown
https://github.com/acme/app/pull/5
                    ↓
2:40 p.m. : PR [acme/app#5](…) opened — docs structure · `docs/x` → `master` · 57 files +5190 −31
```

### Settings

| Setting | What it does |
|---|---|
| **Organisation allowlist** | Only import activity from these GitHub owners. Empty means all of them. |
| **GitHub username** | Whose activity to import. Left blank, Tachado asks `gh` who you are. |
| **Import on open** | Pull new activity every time you open a month note. |

> Why the PR endpoints and not `/events`? GitHub's events feed trims pull-request payloads to nulls and never sees commits on branches that haven't merged — so half your work would go missing.

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
| **Complete a task** | Calendar picker, then the list of what's open — click one to tick it |
| **Drop a task** | The same, but marks it `[DROPPED]` |
| **Move a log entry to another day** | Pick the entry, pick the day it belongs on |
| **Add a log entry** | Calendar picker; writes a timestamped line into any past day |
| **New month note** | Pick a month and year; creates it fully scaffolded, or opens it |
| **New tool or project note** | Drops an `@` at the cursor to open the picker |
| **Import GitHub activity** | Pulls commits, PRs, merges and reviews into this month |
| **Expand GitHub links** | Turns bare commit/PR URLs in this note into full entries |

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

305 assertions covering the `0.N` sort order, promotion, demotion arrival day, checkbox-state preservation, multiple tasks per line, autolinking guards, index generation, bare markers, closing stamps, task pickers, both entity kinds, time rounding, GitHub entry mapping, month skeletons, generated-line handling, the calendar grid, future-day suppression and idempotence. No test framework.

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
- [ ] More entity kinds (people, clients) — currently one line of code, no UI
- [ ] Community plugin directory submission

---

## Why "Tachado"

Spanish for *struck through* — what happens to a task when you finally finish it.

---

## License

[MIT](LICENSE) © Lucia Adams
