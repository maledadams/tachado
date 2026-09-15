'use strict';
const { Plugin, Notice } = require('obsidian');
const { ViewPlugin, Decoration } = require('@codemirror/view');
const { RangeSetBuilder } = require('@codemirror/state');

/* ---------- grammar ----------------------------------------------------- */

// 1.D / 2.W / 3.M, or the carry namespace 0.1.D / 0.2.W ...
// groups: 1=token 2=carry? 3=number 4=scope
const TOK = /(?:^|[\s(\[])((0\.)?(\d+)\.([DWM]))(?![\w.])/;

const RANK = { D: 0, W: 1, M: 2 };
const LIST = { D: 'Daily', W: 'Week', M: 'Month' };

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

/* ---------- render ------------------------------------------------------ */

const renderLine = (t) => {
  const box  = t.state === 'done' ? 'x' : t.state === 'dropped' ? '-' : ' ';
  const body = t.state === 'open' ? t.text : `~~${t.text}~~`;
  const flag = t.state === 'dropped' ? ' [DROPPED]' : '';
  return `- [${box}] ${t.num} — ${body}${flag}`;
};

function rebuild(text) {
  const doc   = parse(text);
  const tasks = resolve(doc);
  const out   = doc.lines.slice();

  // replace each report block's body, back to front so indices stay valid
  for (const r of [...doc.reports].reverse()) {
    const level = doc.lines[r.at].match(/^#+/)[0].length;
    let end = r.at + 1;
    while (end < out.length && !(/^#{1,6}\s/.test(out[end]) && out[end].match(/^#+/)[0].length <= level)) end++;

    const periodId = r.kind === 'D' ? r.day : r.kind === 'W' ? r.week : 0;
    const rows = bucket(tasks, r.kind, periodId).map(renderLine);
    out.splice(r.at + 1, end - r.at - 1, '', ...(rows.length ? rows : ['*nothing*']), '');
  }
  return out.join('\n');
}

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

/* ---------- plugin ------------------------------------------------------ */

module.exports = class TaskLog extends Plugin {
  async onload() {
    this.registerEditorExtension(livePlugin);
    this.registerMarkdownPostProcessor(paintReading);

    this.addCommand({
      id: 'tasklog-rebuild',
      name: 'Rebuild TO-DO reports',
      callback: () => this.run(),
    });

    // carry-over happens on its own: open the month file, reports are current
    this.registerEvent(
      this.app.workspace.on('file-open', (f) => {
        if (f && f.extension === 'md' && /\b(20\d\d)\b/.test(f.basename)) this.run(f);
      })
    );
  }

  async run(file) {
    const f = file || this.app.workspace.getActiveFile();
    if (!f) return;
    let changed = false;
    await this.app.vault.process(f, (data) => {
      const next = rebuild(data);
      changed = next !== data;
      return next;
    });
    if (changed && file === undefined) new Notice('TO-DO reports rebuilt');
  }
};

module.exports.__test = { parse, resolve, bucket, rebuild, keyOf };
