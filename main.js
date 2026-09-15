'use strict';
const { Plugin, Notice, EditorSuggest } = require('obsidian');
const { ViewPlugin, Decoration } = require('@codemirror/view');
const { RangeSetBuilder } = require('@codemirror/state');

/* ---------- grammar ----------------------------------------------------- */

// 1.D / 2.W / 3.M, or the carry namespace 0.1.D / 0.2.W ...
// groups: 1=token 2=carry? 3=number 4=scope
const TOK = /(?:^|[\s(\[])((0\.)?(\d+)\.([DWM]))(?![\w.])/;

const RANK = { D: 0, W: 1, M: 2 };
const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY',
                'AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

const TOOLS = 'Tools';                       // every tool is a note in here
const IDX_OPEN = '%% tachado:index %%';      // Obsidian comments: invisible when reading
const IDX_CLOSE = '%% /tachado:index %%';

const H_WEEK    = /^#\s+WEEK\s+(\d+)/i;
const H_MONTHLY = /^#\s+.*TO-?DO/i;
const H_WEEKLY  = /^##\s+.*TO-?DO/i;
const H_DAILY   = /^###\s+.*TO-?DO/i;
const H_DAY     = /^##\s+(.*?)(\d{1,2})\s*:?\s*$/;
const TIME      = /^\s*(\d{1,2}:\d{2}\s*[ap]\.\s*m\.)/i;

// Identity of a task is its text, normalised. Edit the wording and the plugin
// treats it as a new task and its checkbox resets.
// ponytail: text-as-key avoids putting any id syntax in your .md. Ceiling is
// exactly that reset. Upgrade path if it ever bites: append an Obsidian block
// ref (` ^t3`) to report lines and key on that instead.
const keyOf = (s) =>
  s.replace(/[“”"'’]/g, '')
   .toLowerCase()
   .replace(/[^a-z0-9à-ÿ ]+/g, ' ')
   .replace(/\s+/g, ' ')
   .trim()
   .slice(0, 60);

/* ---------- parse ------------------------------------------------------- */

function parse(text) {
  const lines = text.split('\n');
  let week = 0, day = 0, time = '';
  const mentions = [];   // every body occurrence of a token, in document order
  const reports  = [];   // generated blocks we own
  const states   = new Map();

  lines.forEach((line, i) => {
    let m;
    if (H_WEEK.test(line))      { week = +line.match(H_WEEK)[1]; return; }
    if (H_DAILY.test(line))     { reports.push({ kind: 'D', at: i, week, day }); return; }
    if (H_WEEKLY.test(line))    { reports.push({ kind: 'W', at: i, week, day }); return; }
    if (H_MONTHLY.test(line))   { reports.push({ kind: 'M', at: i, week, day }); return; }
    if ((m = line.match(H_DAY))) { day = +m[2]; time = ''; return; }
    if (/^#{1,6}\s/.test(line)) return;

    // a generated report line: harvest its checkbox state, don't treat as a mention
    const box = line.match(/^\s*-\s*\[([ xX\-])\]\s*(?:(?:0\.)?\d+\.[DWM])\s*[—-]?\s*(.*)$/);
    if (box) {
      const body = box[2].replace(/~~/g, '').replace(/\s*\[DROPPED\]\s*$/i, '').trim();
      states.set(keyOf(body), box[1] === '-' ? 'dropped' : (box[1] === ' ' ? 'open' : 'done'));
      return;
    }

    const t = line.match(TIME);
    if (t) time = t[1].replace(/\s+/g, ' ').toLowerCase().replace('a. m.', 'a.m.').replace('p. m.', 'p.m.');

    const k = line.match(TOK);
    if (!k) return;
    const after = line.slice(line.indexOf(k[1]) + k[1].length).trim();
    if (!after) return;                       // a bare token is a stub, skip it
    mentions.push({ line: i, week, day, time, scope: k[4], text: after, key: keyOf(after) });
  });

  return { lines, mentions, reports, states };
}

// Collapse mentions into tasks. First mention = origin (and sort order).
// Last mention = current scope, which is how a promotion/demotion is declared:
// you just write the line again later with the new suffix.
function resolve({ mentions, states }) {
  const byKey = new Map();
  for (const m of mentions) {
    const t = byKey.get(m.key);
    if (t) { t.scope = m.scope; t.lastWeek = m.week; t.lastDay = m.day; }
    else byKey.set(m.key, { ...m, origin: m.scope, lastWeek: m.week, lastDay: m.day });
  }
  return [...byKey.values()]
    .sort((a, b) => a.line - b.line)           // document order == chronological
    .map((t) => ({ ...t, state: states.get(t.key) || 'open' }));
}

/* ---------- the 0.N rule ------------------------------------------------ */

// A task sits in the carry namespace when it arrived in this list from
// somewhere earlier: demoted from a longer timeframe, or not finished in its
// own period. Promotion to a longer timeframe is always a plain number.
const periodOf = (week, day, scope) => (scope === 'D' ? day : scope === 'W' ? week : 0);

function bucket(tasks, scope, periodId) {
  const rows = [];
  for (const t of tasks) {
    if (t.scope !== scope) continue;
    const demoted = RANK[t.scope] < RANK[t.origin];
    // a demotion arrives on the day you wrote the new suffix, not on the day
    // the task was first raised
    const arrival = demoted
      ? periodOf(t.lastWeek, t.lastDay, scope)
      : periodOf(t.week, t.day, scope);
    if (arrival > periodId) continue;                        // hasn't arrived yet
    if (arrival < periodId && t.state !== 'open') continue;   // closed, stop dragging it
    rows.push({ ...t, carry: demoted || arrival < periodId });
  }
  // both lists stay in document order, so oldest is always first
  const carried = rows.filter((r) => r.carry);
  const native  = rows.filter((r) => !r.carry);
  return [
    ...carried.map((t, i) => ({ ...t, num: `0.${i + 1}.${scope}` })),
    ...native .map((t, i) => ({ ...t, num: `${i + 1}.${scope}` })),
  ];
}


/* ---------- automatic linking ------------------------------------------- */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARK = String.fromCharCode(0xE000);                       // private-use sentinel, never in prose

// Turn bare mentions of an existing tool into wikilinks, so backlinks and the
// graph actually see them. Existing links, inline code, URLs, markdown links,
// quotes and generated report rows are left alone.
function autolink(line, tools) {
  if (!tools.length || /^\s*(```|>|-\s*\[)/.test(line)) return line;

  const held = [];
  const hold = (m) => MARK + (held.push(m) - 1) + MARK;
  let s = line.replace(/\[\[[^\]]*\]\]|`[^`]*`|https?:\/\/\S+|\[[^\]]*\]\([^)]*\)/g, hold);

  // longest first, so "WispBridge Core" wins over "WispBridge"
  for (const t of [...tools].sort((a, b) => b.name.length - a.name.length)) {
    for (const alias of [t.name, ...(t.aliases || [])]) {
      if (!alias || alias.length < 3) continue;   // too short to match safely
      const re = new RegExp(
        '(?<![\\w\\u00c0-\\u017f/-])(' + escapeRe(alias) + ')(?![\\w\\u00c0-\\u017f/-])', 'gi');
      s = s.replace(re, (m) => hold(m === t.name ? `[[${t.name}]]` : `[[${t.name}|${m}]]`));
    }
  }
  const restore = new RegExp(MARK + '(\\d+)' + MARK, 'g');
  while (restore.test(s)) s = s.replace(restore, (_, i) => held[+i]);
  return s;
}

/* ---------- indexes ------------------------------------------------------ */

// A per-month index: back-link to the year, then every week and day in the note.
function monthIndexBlock(lines, year) {
  const weeks = [], days = [];
  for (const line of lines) {
    let m;
    if ((m = line.match(H_WEEK))) weeks.push({ head: line.replace(/^#\s+/, '').trim(), n: m[1] });
    else if (!/TO-?DO/i.test(line) && (m = line.match(H_DAY)))
      days.push(line.replace(/^##\s+/, '').trim());
  }
  const link = (h, label) => `[[#${h}|${label}]]`;
  const out = [IDX_OPEN, '> [!abstract]- Index'];
  if (year) out.push(`> Year · [[${year} Index|${year}]]`);
  if (weeks.length) out.push('>', `> **Weeks** · ${weeks.map((w) => link(w.head, 'Week ' + w.n)).join(' · ')}`);
  if (days.length) out.push('>', `> **Days** · ${days.map((d) => link(d, d.replace(/[,:]\s*$/, '').replace(/,\s*[A-Za-z]+,\s*/, ' '))).join(' · ')}`);
  out.push(IDX_CLOSE);
  return out;
}

// The year note: every month present, with live open/done/dropped counts.
function yearIndexNote(year, months) {
  const sum = (k) => months.reduce((a, m) => a + m[k], 0);
  const rows = months.map((m) => `| [[${m.basename}\\|${m.month}]] | ${m.open} | ${m.done} | ${m.dropped} |`);
  return [
    `# ${year}`, '',
    `Documentation index for ${year}. Generated by [Tachado](https://github.com/maledadams/tachado) — do not edit by hand.`, '',
    '| Month | Open | Done | Dropped |', '|---|---:|---:|---:|',
    ...(rows.length ? rows : ['| *no months yet* | | | |']), '',
    `**Totals** · ${sum('open')} open · ${sum('done')} done · ${sum('dropped')} dropped`, '',
  ].join('\n');
}

const TOOL_TEMPLATE = (name) => `---
type: tool
aliases: []
url:
---

# ${name}

What it is, and why it shows up in the log.
`;

/* ---------- render ------------------------------------------------------ */

const renderLine = (t) => {
  const box  = t.state === 'done' ? 'x' : t.state === 'dropped' ? '-' : ' ';
  const body = t.state === 'open' ? t.text : `~~${t.text}~~`;
  const flag = t.state === 'dropped' ? ' [DROPPED]' : '';
  return `- [${box}] ${t.num} — ${body}${flag}`;
};

function rebuild(text, tools = [], meta = {}) {
  let lines = text.split('\n');

  // drop the previous index block before parsing so it can't feed itself
  const a = lines.indexOf(IDX_OPEN), b = lines.indexOf(IDX_CLOSE);
  if (a > -1 && b > a) {
    lines.splice(a, b - a + 1);
    while (lines[a] === '') lines.splice(a, 1);      // no blank-line drift on rebuild
    if (a > 0 && lines[a - 1] === '') lines.splice(a - 1, 1);
  }

  // link tool mentions in the body first, so the reports inherit the links
  let inFence = false;
  lines = lines.map((l) => {
    if (/^\s*```/.test(l)) { inFence = !inFence; return l; }
    return inFence ? l : autolink(l, tools);
  });

  const doc = parse(lines.join('\n'));
  const tasks = resolve(doc);
  const out = doc.lines.slice();

  // replace each report block's body, back to front so indices stay valid
  for (const r of [...doc.reports].reverse()) {
    const level = doc.lines[r.at].match(/^#+/)[0].length;
    let end = r.at + 1;
    while (end < out.length && !(/^#{1,6}\s/.test(out[end]) && out[end].match(/^#+/)[0].length <= level)) end++;

    const periodId = r.kind === 'D' ? r.day : r.kind === 'W' ? r.week : 0;
    const rows = bucket(tasks, r.kind, periodId).map(renderLine);
    out.splice(r.at + 1, end - r.at - 1, '', ...(rows.length ? rows : ['*nothing*']), '');
  }

  // index sits at the very top, below an H1 title if the note opens with one
  const at = /^#\s/.test(out[0] || '') ? 1 : 0;
  out.splice(at, 0, ...(at ? [''] : []), ...monthIndexBlock(out, meta.year), '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n');   // one blank line, always
}

const countStates = (text) => {
  const c = { open: 0, done: 0, dropped: 0 };
  for (const l of text.split('\n')) {
    const m = l.match(/^\s*-\s*\[([ xX-])\]\s*(?:0\.)?\d+\.[DWM]\b/);
    if (m) c[m[1] === '-' ? 'dropped' : m[1] === ' ' ? 'open' : 'done']++;
  }
  return c;
};

/* ---------- live colouring (editor) ------------------------------------- */

function decorate(view) {
  const b = new RangeSetBuilder();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const m = line.text.match(TOK);
      // ponytail: first token per line only. Your format never puts two on one line.
      if (m && !/^\s*-\s*\[/.test(line.text)) {
        const s = line.from + line.text.indexOf(m[1]);
        const e = s + m[1].length;
        b.add(s, e, Decoration.mark({ class: `tl-tok tl-${m[4]}` }));
        if (e < line.to) b.add(e, line.to, Decoration.mark({ class: `tl-body tl-${m[4]}` }));
      }
      pos = line.to + 1;
    }
  }
  return b.finish();
}

const livePlugin = ViewPlugin.fromClass(
  class {
    constructor(v) { this.decorations = decorate(v); }
    update(u) { if (u.docChanged || u.viewportChanged) this.decorations = decorate(u.view); }
  },
  { decorations: (v) => v.decorations }
);

/* ---------- live colouring (reading view) ------------------------------- */

function paintReading(el) {
  for (const p of el.querySelectorAll('p, li')) {
    if (p.querySelector('.tl-tok')) continue;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node, hit = null;
    while ((node = walker.nextNode())) {
      const m = node.nodeValue.match(TOK);
      if (m) { hit = { node, m }; break; }
    }
    if (!hit) continue;

    const { node: host, m } = hit;
    const tail = host.splitText(host.nodeValue.indexOf(m[1]));
    const rest = tail.splitText(m[1].length);
    const tok = document.createElement('span');
    tok.className = `tl-tok tl-${m[4]}`;
    tok.textContent = m[1];
    tail.replaceWith(tok);

    // everything after the token on this block takes the same colour
    const after = [];
    const w2 = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let seen = false, n2;
    while ((n2 = w2.nextNode())) {
      if (n2 === rest) seen = true;
      if (seen && n2.nodeValue.trim()) after.push(n2);
    }
    for (const n of after) {
      const s = document.createElement('span');
      s.className = `tl-body tl-${m[4]}`;
      n.replaceWith(s);
      s.appendChild(n);
    }
  }
}

/* ---------- tool picker -------------------------------------------------- */

// Type @ to get a dropdown of every note in Tools/. Pick one to insert a
// wikilink, or keep typing a new name to create the tool note on the spot.
class ToolSuggest extends EditorSuggest {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; }

  onTrigger(cursor, editor) {
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = before.match(/@([\p{L}\p{N} ._-]{0,40})$/u);
    if (!m) return null;
    return { start: { line: cursor.line, ch: cursor.ch - m[0].length }, end: cursor, query: m[1] };
  }

  getSuggestions(ctx) {
    const q = ctx.query.trim().toLowerCase();
    const hits = this.plugin.tools()
      .filter((t) => !q || t.name.toLowerCase().includes(q) || t.aliases.some((a) => a.toLowerCase().includes(q)))
      .map((t) => ({ name: t.name }));
    if (q && !hits.some((h) => h.name.toLowerCase() === q)) hits.push({ name: ctx.query.trim(), create: true });
    return hits;
  }

  renderSuggestion(item, el) {
    el.createEl('div', { text: item.name });
    el.createEl('small', { text: item.create ? `Create ${TOOLS}/${item.name}.md` : TOOLS });
  }

  async selectSuggestion(item) {
    const { editor, start, end } = this.context;
    editor.replaceRange(`[[${item.name}]]`, start, end);
    if (item.create) await this.plugin.createTool(item.name);
  }
}

/* ---------- plugin ------------------------------------------------------- */

const YEAR_DIR = /^(\d{4})\//;

module.exports = class Tachado extends Plugin {
  async onload() {
    this.registerEditorExtension(livePlugin);
    this.registerMarkdownPostProcessor(paintReading);
    this.registerEditorSuggest(new ToolSuggest(this));

    this.addCommand({ id: 'rebuild', name: 'Rebuild TO-DO reports and index', callback: () => this.run(null, true) });
    this.addCommand({ id: 'year-index', name: 'Rebuild year index', callback: () => this.buildYear(null, true) });
    this.addCommand({
      id: 'new-tool',
      name: 'New tool note',
      editorCallback: (editor) => { editor.replaceSelection('@'); this.app.workspace.trigger('editor-change', editor); },
    });

    // carry-over, linking and indexes all happen on open. No button to remember.
    this.registerEvent(this.app.workspace.on('file-open', (f) => this.run(f)));
    this.app.workspace.onLayoutReady(() => this.run(this.app.workspace.getActiveFile()));
  }

  /* ---- tools ---- */

  tools() {
    const folder = this.app.vault.getAbstractFileByPath(TOOLS);
    if (!folder || !folder.children) return [];
    return folder.children
      .filter((f) => f.extension === 'md')
      .map((f) => {
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter || {};
        const aliases = [].concat(fm.aliases || fm.alias || []).filter((a) => typeof a === 'string');
        return { name: f.basename, aliases, file: f };
      });
  }

  async createTool(name) {
    const path = `${TOOLS}/${name}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) return;
    if (!this.app.vault.getAbstractFileByPath(TOOLS)) await this.app.vault.createFolder(TOOLS);
    await this.app.vault.create(path, TOOL_TEMPLATE(name));
    new Notice(`Created ${path}`);
  }

  /* ---- month notes ---- */

  isMonth(f) {
    return f && f.extension === 'md' && YEAR_DIR.test(f.path) && !/ Index$/.test(f.basename)
      && MONTHS.some((m) => f.basename.toUpperCase().startsWith(m));
  }

  async run(file, loud) {
    const f = file || this.app.workspace.getActiveFile();
    if (!this.isMonth(f)) { if (loud) new Notice('Open a month note first, e.g. 2026/SEPTEMBER 2026.md'); return; }
    const year = f.path.match(YEAR_DIR)[1];
    const tools = this.tools();
    let changed = false;
    await this.app.vault.process(f, (data) => {
      const next = rebuild(data, tools, { year });
      changed = next !== data;
      return next;
    });
    if (loud) new Notice(changed ? 'Reports and index rebuilt' : 'Already up to date');
    await this.buildYear(year);
  }

  /* ---- year index ---- */

  async buildYear(year, loud) {
    if (!year) {
      const f = this.app.workspace.getActiveFile();
      year = f && YEAR_DIR.test(f.path) ? f.path.match(YEAR_DIR)[1] : null;
      if (!year) { if (loud) new Notice('Open a note inside a year folder first'); return; }
    }
    const months = this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(`${year}/`) && this.isMonth(f))
      .map((f) => {
        const month = f.basename.toUpperCase().replace(year, '').trim();
        return { basename: f.basename, month, order: MONTHS.indexOf(month), file: f };
      })
      .sort((a, b) => a.order - b.order);

    for (const m of months) Object.assign(m, countStates(await this.app.vault.cachedRead(m.file)));

    const path = `${year}/${year} Index.md`;
    const body = yearIndexNote(year, months);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) await this.app.vault.process(existing, () => body);
    else await this.app.vault.create(path, body);
    if (loud) new Notice(`${path} rebuilt`);
  }
};

module.exports.__test = { parse, resolve, bucket, rebuild, keyOf, autolink,
  monthIndexBlock, yearIndexNote, countStates, MONTHS, TOOL_TEMPLATE };
