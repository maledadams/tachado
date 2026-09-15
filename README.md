<div align="center">

# Tachado

### Colored task tracking and automatic carry-over for Obsidian daily documentation

**Write your work log as it happens. Let the plugin do the bookkeeping.**

[![Obsidian](https://img.shields.io/badge/Obsidian-plugin-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-1B7F4C.svg)](LICENSE)
[![No build step](https://img.shields.io/badge/build-none%20required-0A7EA4)](#development)
[![Tests](https://img.shields.io/badge/self--check-16%20passing-1B7F4C)](check.js)

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
| 📄 **One note per month** | `SEPTEMBER 2026.md` holds every week, day and report. No file sprawl |
| 📦 **Zero dependencies** | 240 lines of plain JavaScript. No npm, no bundler, no build step |

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

Write the token anywhere on a line. The token **and everything after it on that line** takes the scope color, italicized — links included.

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

## Document structure

One note per month. Headings define the skeleton, and the TO-DO headings are the only markers Tachado needs — it owns everything between a report heading and the next heading.

```markdown
# WEEK 3 OF SEPTEMBER          ← week banner

## Mon, September, 14:         ← day
9:40 a.m. : went to the office
1:00 p.m. : 1.D call the bank

### Daily TO-DO Report         ← generated

## END OF WEEK 3 TO-DO REPORT  ← generated

# END OF SEPTEMBER TO-DO REPORT ← generated
```

See [`example/SEPTEMBER 2026.md`](example/SEPTEMBER%202026.md) for a full worked month.

---

## Commands

| Command | What it does |
|---|---|
| **Rebuild TO-DO reports** | Reparses the note and regenerates every report section |

Reports also rebuild automatically whenever you open a note whose name contains a year — so carry-over just happens.

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

16 assertions covering the `0.N` sort order, promotion, demotion arrival day, checkbox-state preservation and idempotence. No test framework.

### Known limitation

**A task's identity is its text.** Reword a task substantially and Tachado treats it as new, resetting its checkbox. This is a deliberate trade: it keeps hidden IDs out of your markdown. The upgrade path (Obsidian block references) is noted in `main.js`.

---

## Roadmap

- [ ] `.docx` export via Pandoc with a reference template — Arial 26 titles, Arial 20 day headings, exact task colors
- [ ] Settings tab for colors and heading levels
- [ ] Community plugin directory submission

---

## Why "Tachado"

Spanish for *struck through* — what happens to a task when you finally finish it.

---

## License

[MIT](LICENSE) © Lucia Adams
