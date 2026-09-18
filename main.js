'use strict';
const { Plugin, Notice, EditorSuggest, PluginSettingTab, Setting, SuggestModal, Modal } = require('obsidian');
const { ViewPlugin, Decoration } = require('@codemirror/view');
const { RangeSetBuilder } = require('@codemirror/state');

/* ---------- grammar ----------------------------------------------------- */

// 1.D / 2.W / 3.M, or the carry namespace 0.1.D / 0.2.W ...
// groups: 1=token 2=carry? 3=number 4=scope
// A task marker is either numbered — 1.D, 2.W, the carry namespace 0.1.D — or
// bare: "D :", "W :", "M :". You never have to work out the number yourself;
// a bare marker is given one on the next rebuild.
const TOK = /(?:^|[\s(\[])((0\.)?(\d+)\.([DWM]))(?![\w.])/;
const TOK_G = /(?:^|[\s(\[])((?:(?:0\.)?\d+\.([DWM])(?![\w.]))|(?:([DWMdwm])[ \t]*:(?=[ \t]|$)))/g;
const BARE_G = /(^|[\s(\[])([DWMdwm])[ \t]*:(?=[ \t]|$)/g;

// Every token on a line, with the span of text that belongs to it: from the
// end of the token to the start of the next one. A single line really does
// carry two tasks ("... 3.D \u201cdo this\u201d BUT 4.D \u201cnot yet\u201d").
function tokensOf(line) {
  const hits = [];
  let m;
  TOK_G.lastIndex = 0;
  while ((m = TOK_G.exec(line))) {
    hits.push({ scope: (m[2] || m[3]).toUpperCase(), bare: !m[2],
                at: m.index + m[0].length - m[1].length, end: TOK_G.lastIndex });
  }
  return hits.map((h, i) => ({
    ...h,
    textFrom: h.end,
    textTo: i + 1 < hits.length ? hits[i + 1].at : line.length,
  }));
}

const RANK = { D: 0, W: 1, M: 2 };
const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY',
                'AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

// Linkable entities. Same machinery for each: one note per thing, its own
// folder, automatic linking, and the @ picker. Add a row to add a kind.
const KINDS = [
  { folder: 'Tools',    type: 'tool',    label: 'Tool',    fields: ['url:'] },
  { folder: 'Projects', type: 'project', label: 'Project', fields: ['status: active', 'started:', 'repo:'] },
];
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

// Either closing marker, with the date it carries. The kind is kept alongside
// the date so that changing a tick to a drop re-dates it rather than inheriting
// the day it was completed.
const STAMP = /\[(completed|dropped)\s+(\d{1,2}\/\d{1,2}\/\d{4})\]/i;

// A row's own text, with the state markers this plugin appends stripped off.
const stripTail = (s) =>
  s.replace(/~~/g, '')
   .replace(/\s*\[completed[^\]]*\]/ig, '')
   .replace(/\s*\[dropped[^\]]*\]/ig, '')
   .trim();

const ddmmyyyy = (d) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

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
      // the date was written the day the box was ticked; never recompute it
      const was = box[2].match(STAMP);
      const body = stripTail(box[2]);
      states.set(keyOf(body), {
        state: box[1] === '-' ? 'dropped' : (box[1] === ' ' ? 'open' : 'done'),
        stamp: was ? was[2] : null,
        stampKind: was ? was[1].toLowerCase() : null,
      });
      return;
    }

    const t = line.match(TIME);
    if (t) time = t[1].replace(/\s+/g, ' ').toLowerCase().replace('a. m.', 'a.m.').replace('p. m.', 'p.m.');

    for (const t of tokensOf(line)) {
      // a separator typed after the marker ("1.D : do the thing") is not part
      // of the task
      const after = line.slice(t.textFrom, t.textTo).trim().replace(/^[:\u2014-]\s*/, '');
      if (!after) continue;                   // a bare token is a stub, skip it
      mentions.push({ seq: mentions.length, line: i, week, day, time,
                      scope: t.scope, text: after, key: keyOf(after) });
    }
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
    .sort((a, b) => a.seq - b.seq)             // document order == chronological
    .map((t) => {
      const s = states.get(t.key);
      return { ...t, state: s ? s.state : 'open',
               stamp: s ? s.stamp : null, stampKind: s ? s.stampKind : null };
    });
}

// Fill in the numbers for bare markers. Numbering runs per scope and per
// period — day for D, week for W, the note for M — continuing from the highest
// number already written there by hand.
function fillNumbers(lines) {
  const top = { D: new Map(), W: new Map(), M: new Map() };
  const at = (scope, week, day) => (scope === 'D' ? day : scope === 'W' ? week : 0);

  let week = 0, day = 0;
  const scan = (fn) => {
    week = 0; day = 0;
    return lines.map((line) => {
      let m;
      if ((m = line.match(H_WEEK))) { week = +m[1]; return line; }
      if (/TO-?DO/i.test(line)) return line;
      if ((m = line.match(H_DAY))) { day = +m[2]; return line; }
      if (/^#{1,6}\s/.test(line) || /^\s*-\s*\[/.test(line)) return line;
      return fn(line);
    });
  };

  // highest number already used, per scope and period
  scan((line) => {
    protect(line, (clean) => {
      for (const t of tokensOf(clean)) {
        if (t.bare) continue;
        const n = +clean.slice(t.at, t.end).replace(/^0\./, '').split('.')[0];
        const key = at(t.scope, week, day);
        const cur = top[t.scope];
        if (!cur.has(key) || cur.get(key) < n) cur.set(key, n);
      }
      return clean;
    });
    return line;
  });

  return scan((line) =>
    protect(line, (clean) =>
      clean.replace(BARE_G, (_, lead, letter) => {
        const scope = letter.toUpperCase();
        const key = at(scope, week, day);
        const n = (top[scope].get(key) || 0) + 1;
        top[scope].set(key, n);
        return `${lead}${n}.${scope}`;
      })));
}

/* ---------- the 0.N rule ------------------------------------------------ */

// A task sits in the carry namespace when it arrived in this list from
// somewhere earlier: demoted from a longer timeframe, or not finished in its
// own period. Promotion to a longer timeframe is always a plain number.
const periodOf = (week, day, scope) => (scope === 'D' ? day : scope === 'W' ? week : 0);

// A task lives in exactly one report per scope: the day it is still open on,
// or the day it was closed. It does not sit in Monday's list and Tuesday's at
// the same time — carrying forward moves it.
//
// `home(task, arrival)` says which period a task belongs to. Without a date
// context there is nowhere to move it to, so it stays where it was raised and
// repeats forward, which is what an undated rebuild does.
function bucket(tasks, scope, periodId, home) {
  const rows = [];
  for (const t of tasks) {
    if (t.scope !== scope) continue;
    const demoted = RANK[t.scope] < RANK[t.origin];
    // a demotion arrives on the day you wrote the new suffix, not on the day
    // the task was first raised
    const arrival = demoted
      ? periodOf(t.lastWeek, t.lastDay, scope)
      : periodOf(t.week, t.day, scope);

    if (home) {
      if (home(t, arrival, scope) !== periodId) continue;
    } else {
      if (arrival > periodId) continue;                        // hasn't arrived yet
      if (arrival < periodId && t.state !== 'open') continue;   // closed, stop dragging it
    }
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

/* ---------- shared text guards ------------------------------------------ */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARK = String.fromCharCode(0xE000);    // private-use sentinel, never in prose
const GUARDED = /\[\[[^\]]*\]\]|`[^`]*`|https?:\/\/\S+|\[[^\]]*\]\([^)]*\)/g;

// Run `fn` over a line with links, inline code and URLs held out of reach, so
// a rewrite can never reach inside one.
function protect(line, fn) {
  const held = [];
  const hold = (m) => MARK + (held.push(m) - 1) + MARK;
  let out = fn(line.replace(GUARDED, hold), hold);
  const restore = new RegExp(MARK + '(\\d+)' + MARK, 'g');
  while (restore.test(out)) out = out.replace(restore, (_, i) => held[+i]);
  return out;
}

/* ---------- time -------------------------------------------------------- */

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const titleCase = (s) => s[0] + s.slice(1).toLowerCase();

const TIME_ANY = /(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/gi;

// House rule: every time is on a 5-minute boundary, 12-hour, "a.m."/"p.m.".
// Rounding can roll the hour, the meridiem, and past midnight.
function roundTime(hour, minute, meridiem) {
  let t = (hour % 12) * 60 + minute + (meridiem.toLowerCase() === 'p' ? 720 : 0);
  t = ((Math.round(t / 5) * 5) % 1440 + 1440) % 1440;
  const h24 = Math.floor(t / 60);
  return `${h24 % 12 === 0 ? 12 : h24 % 12}:${String(t % 60).padStart(2, '0')} ` +
         `${h24 >= 12 ? 'p' : 'a'}.m.`;
}

const normalizeTimes = (line) =>
  protect(line, (s) => s.replace(TIME_ANY, (_, h, m, mer) => roundTime(+h, +m, mer)));

/* ---------- automatic linking ------------------------------------------- */

// A line this plugin generated from GitHub. Its text is a record of what the
// commit or PR actually says, so it is never rewritten.
const GEN_LINE = /^\s*\d{1,2}:\d{2}\s*[ap]\.\s*m\.\s*:\s*(?:commit|PR|reviewed)\s\[/i;

// Wikilinks back to plain text, for lines that should never have had them.
const unlink = (line) =>
  line.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');

// Turn bare mentions of an existing tool or project into wikilinks, so
// backlinks and the graph actually see them.
function autolink(line, entities) {
  if (GEN_LINE.test(line)) return unlink(line);
  if (!entities.length || /^\s*(```|>|-\s*\[)/.test(line)) return line;

  return protect(line, (s, hold) => {
    // longest first, so "WispBridge Core" wins over "WispBridge"
    for (const e of [...entities].sort((a, b) => b.name.length - a.name.length)) {
      for (const alias of [e.name, ...(e.aliases || [])]) {
        if (!alias || alias.length < 2) continue;   // 1 char is too ambiguous to match
        const re = new RegExp(
          '(?<![\\w\\u00c0-\\u017f/-])(' + escapeRe(alias) + ')(?![\\w\\u00c0-\\u017f/-])', 'gi');
        s = s.replace(re, (m) => hold(m === e.name ? `[[${e.name}]]` : `[[${e.name}|${m}]]`));
      }
    }
    return s;
  });
}

/* ---------- placing a day in a month ------------------------------------- */

// Which calendar week of the month a date falls in. Weeks start on Monday, so
// the 1st is in week 1 whatever day it lands on.
function weekOfMonth(year, monthIdx, day) {
  let w = 1;
  for (let d = 2; d <= day; d++) if ((new Date(year, monthIdx, d).getDay() + 6) % 7 === 0) w++;
  return w;
}

// Sort key for the headings that make up a month note, so anything can be
// slotted in at the right place: [week, day, rank].
function headingKey(line, year, monthIdx) {
  let m;
  if ((m = line.match(/^#\s+WEEK\s+(\d+)\s+OF\s/i))) return [+m[1], 0, 0];
  if ((m = line.match(/^##\s+END OF WEEK\s+(\d+)/i))) return [+m[1], 99, 2];
  if (/^#\s+END OF\s.*TO-?DO/i.test(line)) return [99, 99, 3];
  if (!/TO-?DO/i.test(line) && (m = line.match(H_DAY)))
    return [weekOfMonth(year, monthIdx, +m[2]), +m[2], 1];
  return null;
}

const cmpKey = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function insertByKey(lines, year, monthIdx, key, block) {
  let at = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const k = headingKey(lines[i], year, monthIdx);
    if (k && cmpKey(k, key) > 0) { at = i; break; }
  }
  lines.splice(at, 0, ...block);
  return at;
}

// Index of the heading for `day`, creating it — and its week banner and the
// week's report — if the note doesn't have them yet.
function ensureDay(lines, year, monthIdx, day) {
  const isDay = (l) => {
    const k = headingKey(l, year, monthIdx);
    return k && k[2] === 1 && k[1] === day;
  };
  let at = lines.findIndex(isDay);
  if (at >= 0) return at;

  const name = MONTHS[monthIdx];
  const week = weekOfMonth(year, monthIdx, day);
  const hasWeek = lines.some((l) => {
    const k = headingKey(l, year, monthIdx);
    return k && k[2] === 0 && k[0] === week;
  });
  if (!hasWeek) {
    insertByKey(lines, year, monthIdx, [week, 0, 0], [`# WEEK ${week} OF ${name}`, '']);
    insertByKey(lines, year, monthIdx, [week, 99, 2], [`## END OF WEEK ${week} TO-DO REPORT`, '']);
  }

  const dow = (new Date(year, monthIdx, day).getDay() + 6) % 7;
  insertByKey(lines, year, monthIdx, [week, day, 1],
    [`## ${DOW[dow]}, ${titleCase(name)}, ${day}:`, '', '### Daily TO-DO Report', '']);
  return lines.findIndex(isDay);
}

/* ---------- time input --------------------------------------------------- */

// What someone types into the time box: "3:45 p.m.", "15:45", "3pm", "9:07".
function parseTimeInput(raw) {
  const t = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  let m;
  if ((m = t.match(/^(\d{1,2})(?::(\d{2}))?([ap])\.?m?\.?$/)))
    return roundTime(+m[1] % 12 || 12, +(m[2] || 0), m[3]);
  if ((m = t.match(/^(\d{1,2}):(\d{2})$/))) {
    const h = +m[1];
    if (h > 23 || +m[2] > 59) return null;
    return roundTime(h % 12 || 12, +m[2], h >= 12 ? 'p' : 'a');
  }
  return null;
}

const nowRounded = (now = new Date()) =>
  roundTime(now.getHours() % 12 || 12, now.getMinutes(), now.getHours() >= 12 ? 'p' : 'a');

/* ---------- a month grid -------------------------------------------------- */

// Weeks of a month as rows of 7, Monday first, with null for padding.
function calendarGrid(year, monthIdx) {
  const last = new Date(year, monthIdx + 1, 0).getDate();
  const lead = (new Date(year, monthIdx, 1).getDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: last }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

const firstDayOfWeek = (year, monthIdx, week) => {
  const last = new Date(year, monthIdx + 1, 0).getDate();
  for (let d = 1; d <= last; d++) if (weekOfMonth(year, monthIdx, d) === week) return d;
  return 1;
};

// Which day a picker should open on for a given month: today when that month
// is the current one, otherwise its last day. Never the 1st, which is what a
// month's own date carries and is almost never what you meant.
const defaultDay = (year, monthIdx, now = new Date()) =>
  (year === now.getFullYear() && monthIdx === now.getMonth())
    ? now.getDate()
    : new Date(year, monthIdx + 1, 0).getDate();

const isFuture = (year, monthIdx, day, now = new Date()) =>
  new Date(year, monthIdx, day) > new Date(now.getFullYear(), now.getMonth(), now.getDate());

// Every unticked report row in a note, with the report it sits in. Enough to
// show a list of what could be dropped, and to find the line again afterwards.
function openRows(lines) {
  const out = [];
  let week = 0, day = 0, kind = null;

  lines.forEach((line, at) => {
    let m;
    if ((m = line.match(H_WEEK))) { week = +m[1]; kind = null; return; }
    if (H_DAILY.test(line))   { kind = 'D'; return; }
    if (H_WEEKLY.test(line))  { kind = 'W'; return; }
    if (H_MONTHLY.test(line)) { kind = 'M'; return; }
    if (!/TO-?DO/i.test(line) && (m = line.match(H_DAY))) { day = +m[2]; kind = null; return; }
    if (/^#{1,6}\s/.test(line)) { kind = null; return; }
    if (!kind) return;

    m = line.match(/^(\s*-\s*)\[ \](\s*)((?:0\.)?\d+\.[DWM])\s*[—-]?\s*(.*)$/);
    if (m) out.push({ at, kind, week, day, num: m[3], text: stripTail(m[4]) });
  });

  return out;
}

// Every timestamped line you wrote, with the day it currently sits under.
// Report rows and headings are not log lines and are never returned.
function logRows(lines) {
  const out = [];
  let week = 0, day = 0, inReport = false;

  lines.forEach((line, at) => {
    let m;
    if ((m = line.match(H_WEEK))) { week = +m[1]; inReport = false; return; }
    if (H_DAILY.test(line) || H_WEEKLY.test(line) || H_MONTHLY.test(line)) { inReport = true; return; }
    if (!/TO-?DO/i.test(line) && (m = line.match(H_DAY))) { day = +m[2]; inReport = false; return; }
    if (/^#{1,6}\s/.test(line)) { inReport = false; return; }
    if (inReport || !day) return;

    const t = minutesOf(line);
    if (t !== null) out.push({ at, day, week, mins: t, text: line });
  });

  return out;
}

// Move one log line to another day, keeping it in time order there.
function moveRow(lines, at, year, monthIdx, toDay) {
  const line = lines[at];
  if (minutesOf(line) === null) return false;
  lines.splice(at, 1);
  // the line had a blank on each side; leave one, not two
  while (at > 0 && lines[at] === '' && lines[at - 1] === '') lines.splice(at, 1);
  insertEntry(lines, ensureDay(lines, year, monthIdx, toDay), line);
  return true;
}

// Move a row's box to done or dropped. The date is written by the rebuild that
// follows, exactly as when you click the checkbox yourself.
function closeRow(lines, at, mark) {
  const line = lines[at];
  if (!/^\s*-\s*\[ \]/.test(line)) return false;
  lines[at] = line.replace(/^(\s*-\s*)\[ \]/, `$1[${mark}]`);
  return true;
}

/* ---------- a blank month ------------------------------------------------ */

// Every day of the month, already grouped into calendar weeks and carrying its
// report headings, so a new month opens ready to write in.
// Weeks start on Monday and are numbered within the month, which is what makes
// Mon 14 September 2026 land in week 3. A month therefore has five or six
// weeks as often as it has four.
function monthSkeleton(monthIdx, year) {
  const name = MONTHS[monthIdx];
  const pretty = titleCase(name);
  const last = new Date(year, monthIdx + 1, 0).getDate();
  const out = [`# ${name} ${year}`, ''];
  let week = 0;

  for (let d = 1; d <= last; d++) {
    const dow = (new Date(year, monthIdx, d).getDay() + 6) % 7;   // 0 = Monday
    if (d === 1 || dow === 0) {
      if (week) out.push(`## END OF WEEK ${week} TO-DO REPORT`, '');
      out.push(`# WEEK ${++week} OF ${name}`, '');
    }
    out.push(`## ${DOW[dow]}, ${pretty}, ${d}:`, '', '### Daily TO-DO Report', '');
  }

  if (week) out.push(`## END OF WEEK ${week} TO-DO REPORT`, '');
  out.push(`# END OF ${name} TO-DO REPORT`, '');
  return out.join('\n') + '\n';
}

// Months offered by the picker: this year first, then next, then last.
function monthChoices(today = new Date()) {
  const y = today.getFullYear();
  const out = [];
  for (const year of [y, y + 1, y - 1])
    for (let m = 0; m < 12; m++) out.push({ month: m, year, label: `${MONTHS[m]} ${year}` });
  return out;
}

/* ---------- github activity --------------------------------------------- */

const GH_URL = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(commit|pull)\/([\w]+)(?:\/\w*)?/;

function parseGhUrl(url) {
  const m = url.match(GH_URL);
  return m ? { owner: m[1], repo: m[2], kind: m[3], id: m[4] } : null;
}

// An ISO timestamp -> this log's time format, on a 5-minute boundary.
function stamp(iso) {
  const d = new Date(iso);
  return roundTime(d.getHours() % 12 === 0 ? 12 : d.getHours() % 12, d.getMinutes(),
                   d.getHours() >= 12 ? 'p' : 'a');
}

const slug = (owner, repo) => `${owner}/${repo}`;
const subject = (msg) => (msg || '').split('\n')[0].trim();
const stats = (s) =>
  s && (s.files || s.additions || s.deletions)
    ? ` · ${s.files} files +${s.additions} −${s.deletions}`
    : '';

const commitSig = (owner, repo, sha) => `[${slug(owner, repo)}@${String(sha).slice(0, 7)}]`;

function commitEntry(c) {
  return `${stamp(c.date)} : commit ${commitSig(c.owner, c.repo, c.sha)}(${c.url})` +
         ` — ${subject(c.message)}${stats(c)}`;
}

function prEntry(p) {
  const ref = `PR [${slug(p.owner, p.repo)}#${p.number}](${p.url})`;
  if (p.action === 'merged') return `${stamp(p.date)} : ${ref} merged into \`${p.base}\`${stats(p)}`;
  if (p.action === 'closed') return `${stamp(p.date)} : ${ref} closed`;
  if (p.action === 'reopened') return `${stamp(p.date)} : ${ref} reopened`;
  return `${stamp(p.date)} : ${ref} opened — ${subject(p.title)}` +
         (p.head && p.base ? ` · \`${p.head}\` → \`${p.base}\`` : '') + stats(p);
}

function reviewEntry(r) {
  const verdict = { approved: 'approved', changes_requested: 'changes requested', commented: 'commented' };
  return `${stamp(r.date)} : reviewed [${slug(r.owner, r.repo)}#${r.number}](${r.url})` +
         ` — ${verdict[String(r.state).toLowerCase()] || r.state}`;
}

// GitHub's /events feed trims pull-request payloads to nulls and misses
// commits on unmerged branches, so we read the PR endpoints instead. These
// map raw `gh` JSON onto log lines; the fetching itself lives in the plugin.

// `sig` is the part of the line that does not drift: a PR's file counts change
// while it is open, so de-duplicating on the whole line would re-import it on
// every run, and de-duplicating on the bare URL would collide with a URL you
// merely mentioned in prose.
const entry = (iso, url, sig, line) => ({ iso, url, sig, line });

// repos/{owner}/{repo}/pulls/{n}
function prToEntries(pr, repoFull) {
  const [owner, repo] = repoFull.split('/');
  const base = { owner, repo, number: pr.number, url: pr.html_url };
  const out = [entry(pr.created_at, pr.html_url, `#${pr.number}](${pr.html_url}) opened`, prEntry({
    ...base, action: 'opened', title: pr.title, date: pr.created_at,
    head: pr.head?.ref, base: pr.base?.ref,
    files: pr.changed_files, additions: pr.additions, deletions: pr.deletions,
  }))];

  if (pr.merged_at)
    out.push(entry(pr.merged_at, pr.html_url + '#merged', `#${pr.number}](${pr.html_url}) merged`, prEntry({
      ...base, action: 'merged', base: pr.base?.ref, date: pr.merged_at,
      files: pr.changed_files, additions: pr.additions, deletions: pr.deletions,
    })));
  else if (pr.closed_at)
    out.push(entry(pr.closed_at, pr.html_url + '#closed', `#${pr.number}](${pr.html_url}) closed`,
                   prEntry({ ...base, action: 'closed', date: pr.closed_at })));
  return out;
}

// repos/{owner}/{repo}/commits, or .../pulls/{n}/commits
function commitsToEntries(list, repoFull, me) {
  const [owner, repo] = repoFull.split('/');
  return (list || [])
    .filter((c) => !me || !c.author?.login || c.author.login.toLowerCase() === me.toLowerCase())
    .map((c) => entry(c.commit?.author?.date, c.html_url, commitSig(owner, repo, c.sha), commitEntry({
      owner, repo, sha: c.sha, message: c.commit?.message, url: c.html_url,
      date: c.commit?.author?.date,
      files: c.files?.length, additions: c.stats?.additions, deletions: c.stats?.deletions,
    })));
}

// repos/{owner}/{repo}/pulls/{n}/reviews
function reviewsToEntries(list, repoFull, number, prUrl, me) {
  const [owner, repo] = repoFull.split('/');
  return (list || [])
    .filter((r) => r.state && String(r.state).toUpperCase() !== 'PENDING')
    .filter((r) => !me || r.user?.login?.toLowerCase() === me.toLowerCase())
    .map((r) => entry(r.submitted_at, r.html_url || `${prUrl}#review`,
                      `#${number}](${prUrl}) \u2014 ${String(r.state).toLowerCase()}`, reviewEntry({
      owner, repo, number, url: prUrl, state: r.state, date: r.submitted_at,
    })));
}

// Drop anything without a timestamp, de-duplicate by url, oldest first.
const tidy = (entries) => {
  const seen = new Set();
  return entries
    .filter((e) => e && e.iso && e.line && !seen.has(e.sig) && seen.add(e.sig))
    .sort((a, b) => a.iso.localeCompare(b.iso));
};

/* ---------- placing an entry in the right day ---------------------------- */

// Minutes since midnight for a line that opens with a timestamp, else null.
function minutesOf(line) {
  const m = line.match(/^\s*(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i);
  if (!m) return null;
  return (+m[1] % 12) * 60 + +m[2] + (m[3].toLowerCase() === 'p' ? 720 : 0);
}

// Insert a timestamped line into a day's body, in chronological order among
// the other timestamped lines. Prose without a timestamp is never reordered.
function insertEntry(lines, dayAt, entry) {
  let end = dayAt + 1;
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++;

  const mins = minutesOf(entry);
  let at = end;
  for (let i = dayAt + 1; i < end; i++) {
    const m = minutesOf(lines[i]);
    if (m !== null && mins !== null && m > mins) { at = i; break; }
  }
  // only trim trailing blanks when appending, and never the blank line that
  // separates the day heading from its body
  if (at === end)
    while (at > dayAt + 2 && lines[at - 1] === '') at--;
  lines.splice(at, 0, entry);
  return lines;
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

const ENTITY_TEMPLATE = (name, kind) => `---
type: ${kind.type}
aliases: []
${kind.fields.join('\n')}
---

# ${name}

What it is, and why it shows up in the log.
`;

/* ---------- render ------------------------------------------------------ */

const renderLine = (t, today) => {
  const box  = t.state === 'done' ? 'x' : t.state === 'dropped' ? '-' : ' ';
  const body = t.state === 'open' ? t.text : `~~${t.text}~~`;
  // reuse the date already on the row only if it was written for this state
  const kind = t.state === 'done' ? 'completed' : t.state === 'dropped' ? 'dropped' : null;
  const when = t.stampKind === kind && t.stamp ? t.stamp : ddmmyyyy(today);
  const flag = kind === 'completed' ? ` [completed ${when}]`
             : kind === 'dropped'   ? ` [DROPPED ${when}]`
             : '';
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
    return inFence ? l : autolink(normalizeTimes(l), tools);
  });

  // A day heading with no report under it has nowhere to receive a carried
  // task, so give every day one. Word exports routinely lack them.
  {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      out.push(lines[i]);
      if (/TO-?DO/i.test(lines[i]) || !H_DAY.test(lines[i])) continue;
      let j = i + 1, has = false;
      while (j < lines.length && !/^#{1,2}\s/.test(lines[j])) {
        if (H_DAILY.test(lines[j])) has = true;
        j++;
      }
      for (let k = i + 1; k < j; k++) out.push(lines[k]);
      if (!has) out.push('', '### Daily TO-DO Report', '');
      i = j - 1;
    }
    lines = out;
  }

  // a weekly report converted from Word arrives as "END OF WEEK TO-DO REPORT";
  // label it with the week it sits in so it can be sorted and reported on
  let seenWeek = 0;
  lines = lines.map((l) => {
    const w = l.match(H_WEEK);
    if (w) { seenWeek = +w[1]; return l; }
    return seenWeek && /^##\s+END OF WEEK\s+TO-?DO/i.test(l)
      ? `## END OF WEEK ${seenWeek} TO-DO REPORT` : l;
  });

  lines = fillNumbers(lines);

  const doc = parse(lines.join('\n'));
  const tasks = resolve(doc);
  const out = doc.lines.slice();

  // Where the clock currently stands inside this note's month. A month that
  // has already passed is "at its end"; one still ahead has not started.
  const y = +meta.year, mo = meta.month;
  const known = Number.isFinite(y) && Number.isFinite(mo);
  const now = meta.today || new Date();
  const lastDay = known ? new Date(y, mo + 1, 0).getDate() : 0;

  const elapsed = !known ? 0
    : (y < now.getFullYear() || (y === now.getFullYear() && mo < now.getMonth())) ? 1
    : (y === now.getFullYear() && mo === now.getMonth()) ? 0 : -1;

  const nowDay = elapsed > 0 ? lastDay : elapsed < 0 ? -Infinity : now.getDate();
  const nowIn = (scope) =>
    scope === 'D' ? nowDay
    : scope === 'W' ? (elapsed > 0 ? weekOfMonth(y, mo, lastDay)
                      : elapsed < 0 ? -Infinity
                      : weekOfMonth(y, mo, now.getDate()))
    : 0;

  // Which reports this note actually has, per scope. A task can only move to a
  // day that exists here, so a sparse note parks it on the latest one it has
  // rather than dropping it on the floor.
  const slots = {};
  for (const scope of ['D', 'W', 'M'])
    slots[scope] = [...new Set(doc.reports.filter((r) => r.kind === scope)
      .map((r) => (scope === 'D' ? r.day : scope === 'W' ? r.week : 0)))].sort((a, b) => a - b);

  // An open task rides along to wherever "now" is; a closed one stays put.
  const home = known
    ? (t, arrival, scope) => {
        if (t.state !== 'open') return arrival;
        const target = Math.max(arrival, nowIn(scope));
        let best = arrival;
        for (const p of slots[scope]) if (p >= arrival && p <= target) best = p;
        return best;
      }
    : null;

  // replace each report block's body, back to front so indices stay valid
  for (const r of [...doc.reports].reverse()) {
    const level = doc.lines[r.at].match(/^#+/)[0].length;
    let end = r.at + 1;
    while (end < out.length && !(/^#{1,6}\s/.test(out[end]) && out[end].match(/^#+/)[0].length <= level)) end++;

    const periodId = r.kind === 'D' ? r.day : r.kind === 'W' ? r.week : 0;
    const rows = bucket(tasks, r.kind, periodId, home).map((t) => renderLine(t, now));
    out.splice(r.at + 1, end - r.at - 1, '', ...(rows.length ? rows : ['*nothing*']), '');
  }

  // the note's own title, restored if anything upstream dropped it
  if (known) {
    const title = `# ${MONTHS[mo]} ${y}`;
    if (!out.some((l) => l.trim() === title)) out.unshift(title, '');
  }

  // index sits at the very top, below an H1 title if the note opens with one
  const at = /^#\s/.test(out[0] || '') ? 1 : 0;
  out.splice(at, 0, ...(at ? [''] : []), ...monthIndexBlock(out, meta.year), '');

  // every heading gets a blank line above it, whatever was inserted before it
  const spaced = [];
  for (const l of out) {
    if (/^#{1,6}\s/.test(l) && spaced.length && spaced[spaced.length - 1] !== '') spaced.push('');
    spaced.push(l);
  }
  return spaced.join('\n').replace(/\n{3,}/g, '\n\n');   // one blank line, always
}

// One task carried across a fortnight is one task, not fourteen, so rows are
// collapsed by their text before counting.
const countStates = (text) => {
  const c = { open: 0, done: 0, dropped: 0 };
  const seen = new Set();
  for (const l of text.split('\n')) {
    const m = l.match(/^\s*-\s*\[([ xX-])\]\s*(?:0\.)?\d+\.[DWM]\s*[\u2014-]?\s*(.*)$/);
    if (!m) continue;
    const key = keyOf(stripTail(m[2]));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    c[m[1] === '-' ? 'dropped' : m[1] === ' ' ? 'open' : 'done']++;
  }
  return c;
};

/* ---------- live colouring (editor) ------------------------------------- */

function decorate(view) {
  const b = new RangeSetBuilder();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      if (!/^\s*-\s*\[/.test(line.text)) {
        for (const t of tokensOf(line.text)) {
          b.add(line.from + t.at, line.from + t.end, Decoration.mark({ class: `tl-tok tl-${t.scope}` }));
          if (t.textTo > t.textFrom)
            b.add(line.from + t.textFrom, line.from + t.textTo,
                  Decoration.mark({ class: `tl-body tl-${t.scope}` }));
        }
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

// Wrap one character range of a block in a span, splitting text nodes as
// needed. Ranges are applied back to front so earlier offsets stay valid.
function wrapRange(nodes, start, end, cls) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i].node;
    if (!node.parentNode) continue;
    const len = node.nodeValue.length;
    const a = Math.max(start - nodes[i].start, 0);
    const b = Math.min(end - nodes[i].start, len);
    if (a >= b) continue;

    let target = node;
    if (b < len) target.splitText(b);
    if (a > 0) target = target.splitText(a);
    const span = document.createElement('span');
    span.className = cls;
    target.replaceWith(span);
    span.appendChild(target);
  }
}

function paintReading(el) {
  for (const block of el.querySelectorAll('p, li')) {
    if (block.querySelector('.tl-tok')) continue;

    const nodes = [];
    let full = '';
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: full.length });
      full += node.nodeValue;
    }

    if (/^\s*\[[ xX-]\]/.test(full)) continue;        // generated report row
    const toks = tokensOf(full);
    if (!toks.length) continue;

    const ranges = [];
    for (const t of toks) {
      ranges.push([t.at, t.end, `tl-tok tl-${t.scope}`]);
      if (t.textTo > t.textFrom) ranges.push([t.textFrom, t.textTo, `tl-body tl-${t.scope}`]);
    }
    for (const [a, b, cls] of ranges.reverse()) wrapRange(nodes, a, b, cls);
  }
}

/* ---------- gh ----------------------------------------------------------- */

// We shell out to the GitHub CLI rather than storing a token. gh is already
// authenticated on the machine, so no secret ever lands in the vault.
// ponytail: desktop only, and it needs gh on PATH. The alternative was a
// personal access token in data.json, which leaks the moment the vault is
// pushed anywhere. Upgrade path: Obsidian's requestUrl() plus a token, if
// mobile ever matters.
function gh(args) {
  return new Promise((resolve, reject) => {
    let execFile;
    try { ({ execFile } = require('child_process')); }
    catch { return reject(new Error('GitHub import needs the desktop app.')); }

    const PATH = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
      .filter(Boolean).join(':');
    execFile('gh', args, { env: { ...process.env, PATH }, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || '').trim() || err.message;
          return reject(new Error(/ENOENT/.test(msg)
            ? 'GitHub CLI not found. Install it with: brew install gh'
            : msg));
        }
        try { resolve(JSON.parse(stdout)); } catch { resolve(stdout.trim()); }
      });
  });
}

const DEFAULTS = { orgs: '', me: '', importOnOpen: false };

class TachadoSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl: box } = this;
    box.empty();

    new Setting(box)
      .setName('Organisation allowlist')
      .setDesc('Only import activity from these GitHub owners, comma separated. Leave empty for all.')
      .addText((t) => t
        .setPlaceholder('my-org, another-org')
        .setValue(this.plugin.settings.orgs)
        .onChange(async (v) => { this.plugin.settings.orgs = v; await this.plugin.save(); }));

    new Setting(box)
      .setName('GitHub username')
      .setDesc('Whose activity to import. Left empty, Tachado asks gh who you are.')
      .addText((t) => t
        .setValue(this.plugin.settings.me)
        .onChange(async (v) => { this.plugin.settings.me = v.trim(); await this.plugin.save(); }));

    new Setting(box)
      .setName('Import on open')
      .setDesc('Pull new activity every time a month note is opened.')
      .addToggle((t) => t
        .setValue(this.plugin.settings.importOnOpen)
        .onChange(async (v) => { this.plugin.settings.importOnOpen = v; await this.plugin.save(); }));
  }
}

// The month grid both modals use. `state` carries year/month/day/now; `marked`
// is the set of days worth a dot.
function drawCalendar(box, state, { marked = new Set(), onPick, onShift }) {
  const head = box.createDiv({ cls: 'tl-cal-head' });
  head.createEl('button', { text: '‹', cls: 'tl-cal-nav' }).onclick = () => onShift(-1);
  head.createDiv({ cls: 'tl-cal-title', text: `${titleCase(MONTHS[state.month])} ${state.year}` });
  const next = head.createEl('button', { text: '›', cls: 'tl-cal-nav' });
  next.onclick = () => onShift(1);
  if (isFuture(state.year, state.month + 1, 1, state.now)) next.addClass('is-disabled');

  const grid = box.createDiv({ cls: 'tl-cal' });
  for (const d of DOW) grid.createDiv({ cls: 'tl-cal-dow', text: d });

  for (const row of calendarGrid(state.year, state.month)) {
    for (const d of row) {
      if (d === null) { grid.createDiv({ cls: 'tl-cal-day is-empty' }); continue; }
      const cell = grid.createDiv({ cls: 'tl-cal-day', text: String(d) });
      if (isFuture(state.year, state.month, d, state.now)) { cell.addClass('is-future'); continue; }
      if (d === state.day) cell.addClass('is-selected');
      if (state.year === state.now.getFullYear() && state.month === state.now.getMonth()
          && d === state.now.getDate()) cell.addClass('is-today');
      if (marked.has(d)) cell.addClass('has-tasks');
      cell.onclick = () => onPick(d);
    }
  }
}

/* ---------- log to any day ------------------------------------------------ */

// A month grid you click a day in, then a time and what happened. Future days
// are not selectable: this is a log, not a planner.
class EntryModal extends Modal {
  constructor(plugin, start = new Date()) {
    super(plugin.app);
    this.plugin = plugin;
    this.now = new Date();
    this.year = start.getFullYear();
    this.month = start.getMonth();
    if (isFuture(this.year, this.month, 1, this.now)) {
      this.year = this.now.getFullYear();
      this.month = this.now.getMonth();
    }
    this.day = defaultDay(this.year, this.month, this.now);
  }

  onOpen() {
    this.modalEl.addClass('tl-entry-modal');
    this.titleEl.setText('Add a log entry');
    this.draw();
  }

  shift(by) {
    const d = new Date(this.year, this.month + by, 1);
    if (isFuture(d.getFullYear(), d.getMonth(), 1, this.now)) return;
    this.year = d.getFullYear();
    this.month = d.getMonth();
    const last = new Date(this.year, this.month + 1, 0).getDate();
    this.day = Math.min(this.day, last);
    if (isFuture(this.year, this.month, this.day, this.now)) this.day = this.now.getDate();
    this.draw();
  }

  draw() {
    const { contentEl: box } = this;
    box.empty();

    drawCalendar(box, this, {
      onShift: (by) => this.shift(by),
      onPick: (d) => { this.day = d; this.draw(); this.text?.focus(); },
    });

    const row = box.createDiv({ cls: 'tl-entry-row' });
    this.time = row.createEl('input', { cls: 'tl-entry-time', type: 'text' });
    this.time.value = this.timeValue || nowRounded(this.now);
    this.time.placeholder = '3:45 p.m.';

    this.text = row.createEl('input', { cls: 'tl-entry-text', type: 'text' });
    this.text.placeholder = 'what happened — or 1.D a task';

    const foot = box.createDiv({ cls: 'tl-entry-foot' });
    this.hint = foot.createDiv({ cls: 'tl-entry-hint' });
    const add = foot.createEl('button', { text: 'Add', cls: 'mod-cta' });
    add.onclick = () => this.submit();

    for (const el of [this.time, this.text])
      el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); this.submit(); } };

    this.text.focus();
  }

  async submit() {
    this.timeValue = this.time.value;
    const at = parseTimeInput(this.time.value);
    if (!at) { this.hint.setText("Didn't understand that time"); return; }
    const what = this.text.value.trim();
    if (!what) { this.hint.setText('Say what happened'); return; }

    try {
      await this.plugin.addEntry(this.year, this.month, this.day, `${at} : ${what}`);
      this.close();
    } catch (e) { this.hint.setText(e.message); }
  }
}

/* ---------- close a task -------------------------------------------------- */

const CLOSE = {
  done:    { mark: 'x', verb: 'Complete', title: 'Complete a task', past: 'completed' },
  dropped: { mark: '-', verb: 'Drop',     title: 'Drop a task',     past: 'dropped' },
};

// Pick a day, then pick one of the tasks open on it. The daily report's own
// rows are listed, plus that week's and the month's, so anything open can be
// closed from here.
class CloseModal extends Modal {
  constructor(plugin, mode, file) {
    super(plugin.app);
    this.plugin = plugin;
    this.mode = CLOSE[mode];
    this.file = file;
    this.now = new Date();
    const start = plugin.monthDate(file);
    this.year = start.getFullYear();
    this.month = start.getMonth();
    this.day = defaultDay(this.year, this.month, this.now);
  }

  async onOpen() {
    this.modalEl.addClass('tl-entry-modal');
    this.titleEl.setText(this.mode.title);
    this.lines = (await this.app.vault.cachedRead(this.file)).split('\n');
    this.rows = openRows(this.lines);
    this.draw();
  }

  shift(by) {
    const d = new Date(this.year, this.month + by, 1);
    if (isFuture(d.getFullYear(), d.getMonth(), 1, this.now)) return;
    new CloseModal(this.plugin, this.mode.mark === 'x' ? 'done' : 'dropped', this.file).open();
    this.close();
  }

  // everything closeable from the selected day: its own tasks, its week's, the month's
  forDay() {
    const week = weekOfMonth(this.year, this.month, this.day);
    return this.rows.filter((r) =>
      (r.kind === 'D' && r.day === this.day) ||
      (r.kind === 'W' && r.week === week) ||
      r.kind === 'M');
  }

  draw() {
    const { contentEl: box } = this;
    box.empty();

    drawCalendar(box, this, {
      marked: new Set(this.rows.filter((r) => r.kind === 'D').map((r) => r.day)),
      onShift: (by) => this.shift(by),
      onPick: (d) => { this.day = d; this.draw(); },
    });

    const list = box.createDiv({ cls: 'tl-task-list' });
    const found = this.forDay();
    if (!found.length) {
      list.createDiv({ cls: 'tl-task-empty', text: 'Nothing open on this day.' });
      return;
    }
    for (const row of found) {
      const el = list.createDiv({ cls: 'tl-task' });
      el.createSpan({ cls: `tl-task-num tl-${row.num.slice(-1)}`, text: row.num });
      el.createSpan({ cls: 'tl-task-text', text: row.text });
      el.onclick = () => this.pick(row);
    }
  }

  async pick(row) {
    const ok = await this.plugin.closeTask(this.file, row, this.mode.mark);
    if (ok) new Notice(`Tachado: ${row.num} ${this.mode.past}`);
    else new Notice('Tachado: that row moved — reopen the command');
    this.close();
  }
}

/* ---------- move a log entry ---------------------------------------------- */

// Two passes over the same grid: pick the entry, then pick where it belongs.
class MoveModal extends Modal {
  constructor(plugin, file) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.now = new Date();
    const start = plugin.monthDate(file);
    this.year = start.getFullYear();
    this.month = start.getMonth();
    this.day = defaultDay(this.year, this.month, this.now);
    this.stage = 'pick';
  }

  async onOpen() {
    this.modalEl.addClass('tl-entry-modal');
    this.lines = (await this.app.vault.cachedRead(this.file)).split('\n');
    this.rows = logRows(this.lines);
    this.draw();
  }

  shift(by) {
    const d = new Date(this.year, this.month + by, 1);
    if (isFuture(d.getFullYear(), d.getMonth(), 1, this.now)) return;
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.day = defaultDay(this.year, this.month, this.now);
    this.rows = logRows(this.lines);       // days are per-month; re-read for the new one
    this.draw();
  }

  draw() {
    const { contentEl: box } = this;
    box.empty();
    this.titleEl.setText(this.stage === 'pick' ? 'Move a log entry' : 'Move it to which day?');

    if (this.stage === 'place') {
      box.createDiv({ cls: 'tl-move-chosen', text: this.chosen.text });
    }

    drawCalendar(box, this, {
      marked: new Set(this.rows.map((r) => r.day)),
      onShift: (by) => this.shift(by),
      onPick: (d) => {
        if (this.stage === 'place') return this.place(d);
        this.day = d;
        this.draw();
      },
    });

    if (this.stage === 'place') {
      box.createDiv({ cls: 'tl-task-empty', text: 'Pick the day it should be on.' });
      return;
    }

    const list = box.createDiv({ cls: 'tl-task-list' });
    const found = this.rows.filter((r) => r.day === this.day);
    if (!found.length) {
      list.createDiv({ cls: 'tl-task-empty', text: 'No entries on this day.' });
      return;
    }
    for (const row of found) {
      const el = list.createDiv({ cls: 'tl-task' });
      const cut = row.text.indexOf(':', row.text.indexOf(':') + 1);
      el.createSpan({ cls: 'tl-task-num', text: row.text.slice(0, cut > 0 ? cut : 10).trim() });
      el.createSpan({ cls: 'tl-task-text', text: row.text.slice(cut + 1).trim() });
      el.onclick = () => { this.chosen = row; this.stage = 'place'; this.draw(); };
    }
  }

  async place(toDay) {
    if (toDay === this.chosen.day) { this.close(); return; }
    const ok = await this.plugin.moveEntry(this.file, this.chosen, this.year, this.month, toDay);
    new Notice(ok ? `Tachado: moved to the ${toDay}${ordinal(toDay)}`
                  : 'Tachado: that line moved — reopen the command');
    this.close();
  }
}

const ordinal = (n) =>
  (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';

/* ---------- month picker -------------------------------------------------- */

// Same shape as Obsidian's own quick switcher: type to filter, Enter to pick.
class MonthModal extends SuggestModal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setPlaceholder('Month and year, e.g. October 2026');
  }

  getSuggestions(query) {
    const q = query.trim().toLowerCase();
    return monthChoices().filter((c) => !q || c.label.toLowerCase().includes(q));
  }

  renderSuggestion(choice, el) {
    el.createEl('div', { text: choice.label });
    const path = `${choice.year}/${choice.label}.md`;
    el.createEl('small', {
      text: this.app.vault.getAbstractFileByPath(path) ? 'already exists — opens it' : path,
    });
  }

  onChooseSuggestion(choice) { this.plugin.newMonth(choice); }
}

/* ---------- tool picker -------------------------------------------------- */

// Type @ to get a dropdown of every note in Tools/. Pick one to insert a
// wikilink, or keep typing a new name to create the tool note on the spot.
class EntitySuggest extends EditorSuggest {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; }

  onTrigger(cursor, editor) {
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = before.match(/@([\p{L}\p{N} ._-]{0,40})$/u);
    if (!m) return null;
    return { start: { line: cursor.line, ch: cursor.ch - m[0].length }, end: cursor, query: m[1] };
  }

  getSuggestions(ctx) {
    const q = ctx.query.trim().toLowerCase();
    const hits = this.plugin.entities()
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q)))
      .map((e) => ({ name: e.name, kind: e.kind }));
    // nothing by that name yet? offer to create it, in either folder
    if (q && !hits.some((h) => h.name.toLowerCase() === q))
      for (const kind of KINDS) hits.push({ name: ctx.query.trim(), kind, create: true });
    return hits;
  }

  renderSuggestion(item, el) {
    el.createEl('div', { text: item.name });
    el.createEl('small', {
      text: item.create ? `New ${item.kind.label.toLowerCase()} · ${item.kind.folder}/${item.name}.md`
                        : item.kind.label,
    });
  }

  async selectSuggestion(item) {
    const { editor, start, end } = this.context;
    editor.replaceRange(`[[${item.name}]]`, start, end);
    if (item.create) await this.plugin.createEntity(item.name, item.kind);
  }
}

/* ---------- plugin ------------------------------------------------------- */

const YEAR_DIR = /^(\d{4})\//;

module.exports = class Tachado extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.addSettingTab(new TachadoSettings(this.app, this));
    this.registerEditorExtension(livePlugin);
    this.registerMarkdownPostProcessor(paintReading);
    this.registerEditorSuggest(new EntitySuggest(this));

    this.addCommand({ id: 'rebuild', name: 'Rebuild TO-DO reports and index', callback: () => this.run(null, true) });
    this.addCommand({ id: 'year-index', name: 'Rebuild year index', callback: () => this.buildYear(null, true) });
    for (const [mode, spec] of Object.entries(CLOSE))
      this.addCommand({
        id: `close-${mode}`,
        name: `${spec.verb} a task`,
        callback: () => {
          const f = this.app.workspace.getActiveFile();
          if (!this.isMonth(f)) { new Notice('Open a month note first'); return; }
          new CloseModal(this, mode, f).open();
        },
      });

    this.addCommand({
      id: 'move-entry',
      name: 'Move a log entry to another day',
      callback: () => {
        const f = this.app.workspace.getActiveFile();
        if (!this.isMonth(f)) { new Notice('Open a month note first'); return; }
        new MoveModal(this, f).open();
      },
    });

    this.addCommand({
      id: 'add-entry',
      name: 'Add a log entry',
      callback: () => {
        const f = this.app.workspace.getActiveFile();
        new EntryModal(this, this.isMonth(f) ? this.monthDate(f) : new Date()).open();
      },
    });
    this.addCommand({
      id: 'new-month',
      name: 'New month note',
      callback: () => new MonthModal(this).open(),
    });
    this.addCommand({ id: 'import-github', name: 'Import GitHub activity', callback: () => this.importGh(true) });
    this.addCommand({ id: 'expand-github', name: 'Expand GitHub links', callback: () => this.expandGh() });
    this.addCommand({
      id: 'new-tool',
      name: 'New tool or project note',
      editorCallback: (editor) => { editor.replaceSelection('@'); this.app.workspace.trigger('editor-change', editor); },
    });

    // carry-over, linking and indexes all happen on open. No button to remember.
    this.registerEvent(this.app.workspace.on('file-open', (f) => this.run(f)));
    this.app.workspace.onLayoutReady(() => this.run(this.app.workspace.getActiveFile()));
  }

  save() { return this.saveData(this.settings); }

  orgs() {
    return this.settings.orgs.split(',').map((o) => o.trim()).filter(Boolean);
  }

  async whoami() {
    if (!this.settings.me) {
      this.settings.me = await gh(['api', 'user', '--jq', '.login']);
      await this.save();
    }
    return this.settings.me;
  }

  /* ---- github ---- */

  // Gather activity for one month. Reads the PR endpoints rather than the
  // /events feed, which trims payloads and misses unmerged branches.
  async collect(year, month, me) {
    const since = new Date(year, month, 1).toISOString();
    const until = new Date(year, month + 1, 1).toISOString();
    const inRange = (e) => e.iso >= since && e.iso < until;
    const orgs = this.orgs();
    const out = [];

    const owners = orgs.length ? orgs.map((o) => ['--owner', o]).flat() : [];
    const search = async (flag) => {
      try {
        return await gh(['search', 'prs', flag, me, ...owners,
                         '--limit', '60', '--json', 'number,repository']);
      } catch { return []; }
    };

    const mine = await search('--author');
    for (const hit of mine) {
      const full = hit.repository?.nameWithOwner;
      if (!full) continue;
      try {
        const pr = await gh(['api', `repos/${full}/pulls/${hit.number}`]);
        out.push(...prToEntries(pr, full));
        out.push(...commitsToEntries(await gh(['api', `repos/${full}/pulls/${hit.number}/commits`]), full, me));
      } catch { /* a repo we lost access to; skip it */ }
    }

    for (const hit of await search('--reviewed-by')) {
      const full = hit.repository?.nameWithOwner;
      if (!full) continue;
      try {
        const pr = await gh(['api', `repos/${full}/pulls/${hit.number}`]);
        out.push(...reviewsToEntries(
          await gh(['api', `repos/${full}/pulls/${hit.number}/reviews`]),
          full, hit.number, pr.html_url, me));
      } catch { /* ignore */ }
    }

    // commits pushed straight to a default branch, for repos touched this month
    for (const org of orgs) {
      let repos = [];
      try {
        repos = await gh(['repo', 'list', org, '--limit', '100', '--json', 'nameWithOwner,pushedAt']);
      } catch { continue; }
      for (const r of repos) {
        if (r.pushedAt && r.pushedAt < since) continue;
        try {
          out.push(...commitsToEntries(
            await gh(['api', `repos/${r.nameWithOwner}/commits?author=${me}&since=${since}&per_page=100`]),
            r.nameWithOwner, me));
        } catch { /* empty repo, or no access */ }
      }
    }

    return tidy(out).filter(inRange);
  }

  async importGh(loud) {
    const f = this.app.workspace.getActiveFile();
    if (!this.isMonth(f)) { if (loud) new Notice('Open a month note first'); return; }

    const month = MONTHS.indexOf(f.basename.toUpperCase().split(' ')[0]);
    const year = +f.path.match(YEAR_DIR)[1];
    if (month < 0) return;

    let entries;
    if (loud) new Notice('Tachado: asking GitHub…');
    try {
      entries = await this.collect(year, month, await this.whoami());
    } catch (e) { new Notice(`Tachado: ${e.message}`, 8000); return; }

    let added = 0, skipped = 0;
    await this.app.vault.process(f, (data) => {
      const lines = data.split('\n');
      for (const e of entries) {
        // only a generated line counts as already-imported; a URL you merely
        // wrote in prose does not
        if (lines.some((l) => GEN_LINE.test(l) && l.includes(e.sig))) continue;
        const d = new Date(e.iso);
        const at = lines.findIndex((l) => {
          const m = !/TO-?DO/i.test(l) && l.match(H_DAY);
          return m && +m[2] === d.getDate();
        });
        if (at < 0) { skipped++; continue; }
        insertEntry(lines, at, e.line);
        added++;
      }
      return lines.join('\n');
    });

    if (added) await this.run(f);
    if (loud || added)
      new Notice(`Tachado: ${added} imported` +
                 (skipped ? `, ${skipped} skipped (no day heading)` : ''));
  }

  // Paste a commit or PR link on its own and this fills in the rest.
  async expandGh() {
    const f = this.app.workspace.getActiveFile();
    if (!this.isMonth(f)) { new Notice('Open a month note first'); return; }

    const data = await this.app.vault.cachedRead(f);
    const jobs = [];
    for (const line of data.split('\n')) {
      if (/\]\(https?:\/\/github\.com/.test(line)) continue;   // already a link
      const ref = parseGhUrl(line);
      if (ref && line.includes(ref.owner)) jobs.push({ line, ref });
    }
    if (!jobs.length) { new Notice('No bare GitHub links found'); return; }

    const swaps = new Map();
    for (const { line, ref } of jobs) {
      try {
        const api = ref.kind === 'commit'
          ? `repos/${ref.owner}/${ref.repo}/commits/${ref.id}`
          : `repos/${ref.owner}/${ref.repo}/pulls/${ref.id}`;
        const j = await gh(['api', api]);
        const base = { owner: ref.owner, repo: ref.repo };
        swaps.set(line, ref.kind === 'commit'
          ? commitEntry({ ...base, sha: j.sha, message: j.commit?.message, url: j.html_url,
                          date: j.commit?.author?.date, files: j.files?.length,
                          additions: j.stats?.additions, deletions: j.stats?.deletions })
          : prEntry({ ...base, number: j.number, title: j.title, url: j.html_url,
                      action: j.merged ? 'merged' : j.state === 'closed' ? 'closed' : 'opened',
                      head: j.head?.ref, base: j.base?.ref,
                      date: j.merged_at || j.created_at, files: j.changed_files,
                      additions: j.additions, deletions: j.deletions }));
      } catch (e) { new Notice(`Tachado: ${e.message}`, 8000); }
    }

    if (!swaps.size) return;
    await this.app.vault.process(f, (text) =>
      text.split('\n').map((l) => swaps.get(l) || l).join('\n'));
    await this.run(f);
    new Notice(`Tachado: expanded ${swaps.size}`);
  }

  /* ---- tools ---- */

  entities() {
    const out = [];
    for (const kind of KINDS) {
      const folder = this.app.vault.getAbstractFileByPath(kind.folder);
      if (!folder || !folder.children) continue;
      for (const f of folder.children) {
        if (f.extension !== 'md') continue;
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter || {};
        const aliases = [].concat(fm.aliases || fm.alias || []).filter((a) => typeof a === 'string');
        out.push({ name: f.basename, aliases, kind, file: f });
      }
    }
    return out;
  }

  async createEntity(name, kind) {
    const path = `${kind.folder}/${name}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) return;
    if (!this.app.vault.getAbstractFileByPath(kind.folder)) await this.app.vault.createFolder(kind.folder);
    await this.app.vault.create(path, ENTITY_TEMPLATE(name, kind));
    new Notice(`Created ${path}`);
  }

  /* ---- month notes ---- */

  // The month a note stands for, so the calendar opens where you already are.
  monthDate(file) {
    const month = MONTHS.indexOf(file.basename.toUpperCase().split(' ')[0]);
    const year = +file.path.match(YEAR_DIR)[1];
    return month < 0 ? new Date() : new Date(year, month, 1);
  }

  // Relocate a log line. Matched on its text rather than its line number, so
  // an edit made while the picker was open cannot move the wrong line.
  async moveEntry(file, row, year, month, toDay) {
    let hit = false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const again = logRows(lines).find((r) => r.day === row.day && r.text === row.text);
      if (!again) return data;
      hit = moveRow(lines, again.at, year, month, toDay);
      return hit ? lines.join('\n') : data;
    });
    if (hit) await this.run(file);
    return hit;
  }

  // Flip one report row's checkbox. The row is matched on its text rather than
  // its line number, so an edit between opening the modal and choosing does not
  // close the wrong task.
  async closeTask(file, row, mark) {
    let hit = false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const again = openRows(lines).find((r) =>
        r.kind === row.kind && r.day === row.day && r.week === row.week &&
        keyOf(r.text) === keyOf(row.text));
      if (!again) return data;
      hit = closeRow(lines, again.at, mark);
      return hit ? lines.join('\n') : data;
    });
    if (hit) await this.run(file);
    return hit;
  }

  // Write one timestamped line into a day, creating the month note and the
  // day's headings if they aren't there yet.
  async addEntry(year, month, day, line) {
    const path = `${year}/${MONTHS[month]} ${year}.md`;
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      if (!this.app.vault.getAbstractFileByPath(String(year)))
        await this.app.vault.createFolder(String(year));
      file = await this.app.vault.create(path, monthSkeleton(month, year));
    }

    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const at = ensureDay(lines, year, month, day);
      insertEntry(lines, at, line);
      return lines.join('\n');
    });

    if (this.app.workspace.getActiveFile()?.path !== path)
      await this.app.workspace.getLeaf(false).openFile(file);
    await this.run(file);
    new Notice(`Added to ${MONTHS[month]} ${day}`);
  }

  // Create (or just open) a month note, pre-filled with every day of that
  // month grouped into weeks.
  async newMonth({ month, year }) {
    const path = `${year}/${MONTHS[month]} ${year}.md`;
    let file = this.app.vault.getAbstractFileByPath(path);

    if (!file) {
      if (!this.app.vault.getAbstractFileByPath(String(year)))
        await this.app.vault.createFolder(String(year));
      file = await this.app.vault.create(path, monthSkeleton(month, year));
      new Notice(`Created ${path}`);
    }
    await this.app.workspace.getLeaf(false).openFile(file);
    await this.run(file);
  }

  isMonth(f) {
    return f && f.extension === 'md' && YEAR_DIR.test(f.path) && !/ Index$/.test(f.basename)
      && MONTHS.some((m) => f.basename.toUpperCase().startsWith(m));
  }

  async run(file, loud) {
    const f = file || this.app.workspace.getActiveFile();
    if (!this.isMonth(f)) { if (loud) new Notice('Open a month note first, e.g. 2026/SEPTEMBER 2026.md'); return; }
    const year = f.path.match(YEAR_DIR)[1];
    const month = MONTHS.indexOf(f.basename.toUpperCase().split(' ')[0]);
    const linkables = this.entities();
    let changed = false;
    await this.app.vault.process(f, (data) => {
      const next = rebuild(data, linkables, { year, month, today: new Date() });
      changed = next !== data;
      return next;
    });
    if (loud) new Notice(changed ? 'Reports and index rebuilt' : 'Already up to date');
    await this.buildYear(year);
    if (this.settings.importOnOpen && !this._importing) {
      this._importing = true;
      try { await this.importGh(false); } finally { this._importing = false; }
    }
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
  monthIndexBlock, yearIndexNote, countStates, MONTHS, ENTITY_TEMPLATE, KINDS,
  roundTime, normalizeTimes, protect, unlink, GEN_LINE, ddmmyyyy, stripTail, parseGhUrl, commitEntry, prEntry,
  reviewEntry, prToEntries, commitsToEntries, reviewsToEntries, tidy,
  insertEntry, minutesOf, monthSkeleton, fillNumbers, tokensOf, monthChoices, weekOfMonth, headingKey,
  ensureDay, insertByKey, openRows, closeRow, logRows, moveRow, parseTimeInput, nowRounded, calendarGrid, isFuture, firstDayOfWeek, defaultDay };
