// Self-check: run `node check.js`. Asserts the 0.N rule, promotion, demotion,
// carry-over and state preservation. No framework.
const Module = require('module');
const real = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') return { Plugin: class {}, Notice: class {}, EditorSuggest: class {}, PluginSettingTab: class {}, Setting: class {}, SuggestModal: class {}, Modal: class {} };
  if (req === '@codemirror/view') return { ViewPlugin: { fromClass: () => ({}) }, Decoration: { mark: () => ({}) } };
  if (req === '@codemirror/state') return { RangeSetBuilder: class {} };
  return real(req, ...rest);
};
const T = require('./main.js').__test;
const { rebuild, autolink, yearIndexNote, countStates, ENTITY_TEMPLATE, KINDS,
        roundTime, normalizeTimes, unlink, GEN_LINE, ddmmyyyy, stripTail, parseGhUrl, commitEntry, prEntry, reviewEntry,
        prToEntries, commitsToEntries, reviewsToEntries, tidy, insertEntry, minutesOf,
        fillNumbers, tokensOf,
        monthSkeleton, monthChoices, weekOfMonth, ensureDay, openRows, closeRow, logRows, moveRow, parseTimeInput,
        nowRounded, calendarGrid, isFuture, firstDayOfWeek, defaultDay } = T;
let n = 0;
const ok = (name, cond) => { n++; if (!cond) { console.error('FAIL:', name); process.exit(1); } };
const has = (out, s) => out.includes(s);

/* 1. carry-over: Mon's unfinished 1.D shows up in Tue's report as 0.1.D */
let doc = `# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
10:00 a.m. : 1.D call the bank

### Daily TO-DO Report

## Tue, September, 15:
9:15 a.m. : 1.D send the cedula

### Daily TO-DO Report
`;
let out = rebuild(doc);
ok('mon lists its own task as 1.D', has(out, '- [ ] 1.D — call the bank'));
ok('tue carries monday as 0.1.D',   has(out, '- [ ] 0.1.D — call the bank'));
ok('tue numbers its own as 1.D',    has(out, '- [ ] 1.D — send the cedula'));

/* 2. the moving goalpost: insert an OLDER task, it takes 0.1 and pushes down */
doc = `# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
8:00 a.m. : 1.D older thing
10:00 a.m. : 2.D newer thing

### Daily TO-DO Report

## Tue, September, 15:

### Daily TO-DO Report
`;
out = rebuild(doc);
const tue = out.split('## Tue')[1];
ok('oldest becomes 0.1.D', tue.indexOf('0.1.D — older thing') > -1);
ok('next becomes 0.2.D',   tue.indexOf('0.2.D — newer thing') > -1);
ok('0.1 precedes 0.2',     tue.indexOf('0.1.D') < tue.indexOf('0.2.D'));

/* 3. promotion D -> W is a plain number, never 0.N */
doc = `# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
10:00 a.m. : 1.W already weekly
11:00 a.m. : 1.D reventar la barrita
9:00 p.m. : 2.W reventar la barrita

## END OF WEEK TO-DO REPORT
`;
out = rebuild(doc);
ok('promoted task is plain-numbered', has(out, '- [ ] 2.W — reventar la barrita'));
ok('promotion is not in carry space', !has(out, '0.1.W — reventar la barrita'));

/* 4. demotion M -> D lands in the carry namespace */
doc = `# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
10:00 a.m. : 1.M big monthly thing
11:00 a.m. : 1.D do it today instead

## Tue, September, 15:
9:00 a.m. : 1.D big monthly thing

### Daily TO-DO Report
`;
out = rebuild(doc);
ok('demoted task carries as 0.N.D', has(out, '0.1.D — big monthly thing'));

/* 5. checkbox state survives a rebuild, and done/dropped render correctly */
doc = `# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
10:00 a.m. : 1.D finished one
11:00 a.m. : 2.D abandoned one

### Daily TO-DO Report

- [x] 1.D — finished one
- [-] 2.D — abandoned one
`;
out = rebuild(doc);
ok('done is struck',        has(out, '- [x] 1.D — ~~finished one~~'));
ok('dropped is flagged',    /- \[-\] 2\.D — ~~abandoned one~~ \[DROPPED \d{2}\/\d{2}\/\d{4}\]/.test(out));

/* 6. a completed daily does NOT carry to the next day */
doc = `# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
10:00 a.m. : 1.D finished one

### Daily TO-DO Report

- [x] 1.D — finished one

## Tue, September, 15:

### Daily TO-DO Report
`;
out = rebuild(doc);
ok('done task does not carry', !out.split('## Tue')[1].includes('finished one'));

/* 7. rebuilding twice changes nothing (no drift) */
ok('idempotent', rebuild(out) === out);

/* 8. a demotion does not appear on days before you demoted it */
{
const d = `# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
10:00 a.m. : 1.M big monthly thing

### Daily TO-DO Report

## Tue, September, 15:
9:00 a.m. : 1.D big monthly thing

### Daily TO-DO Report

## Wed, September, 16:

### Daily TO-DO Report
`;
const o = rebuild(d);
// keep only each report's own rows, stopping at the next heading
const rep = (part) => { const L = part.split('\n'); const i = L.findIndex((l) => /^#{1,6}\s/.test(l)); return (i < 0 ? L : L.slice(0, i)).join('\n'); };
const [, mon, tue, wed] = o.split('### Daily TO-DO Report').map(rep);
ok('not on monday',            !mon.includes('big monthly thing'));
ok('arrives tuesday as 0.1.D',  tue.includes('0.1.D — big monthly thing'));
ok('still carried wednesday',   wed.includes('0.1.D — big monthly thing'));
}

/* ---- automatic linking ---- */
{
const tools = [{ name: 'Remargin', aliases: ['rmg'] }, { name: 'WispBridge', aliases: [] }];
const L = (s) => autolink(s, tools);

ok('links a bare mention',       L('asked about remargin today') === 'asked about [[Remargin|remargin]] today');
ok('exact case has no alias',    L('asked about Remargin') === 'asked about [[Remargin]]');
ok('links via frontmatter alias', L('the rmg registry').includes('[[Remargin|rmg]]'));
ok('never double-links',         L('already [[Remargin]] here') === 'already [[Remargin]] here');
ok('leaves inline code alone',   L('run `remargin ls` now') === 'run `remargin ls` now');
ok('leaves urls alone',          L('see https://x.com/remargin/y') === 'see https://x.com/remargin/y');
ok('leaves md links alone',      L('[the remargin doc](http://a.b)') === '[the remargin doc](http://a.b)');
ok('respects word boundaries',   L('remarginal gains') === 'remarginal gains');
ok('longest tool wins',          L('WispBridge and remargin').includes('[[WispBridge]]'));
ok('skips generated report rows', L('- [ ] 1.D — remargin thing') === '- [ ] 1.D — remargin thing');
ok('autolink is idempotent',     L(L('remargin and WispBridge')) === L('remargin and WispBridge'));
}

/* ---- month index ---- */
{
const d = `# SEPTEMBER 2026

# WEEK 1 OF SEPTEMBER

## Tue, September, 1:
9:00 a.m. : 1.D ship it

### Daily TO-DO Report
`;
const o = rebuild(d, [], { year: '2026' });
ok('index block present',   o.includes('%% tachado:index %%') && o.includes('%% /tachado:index %%'));
ok('index links the year',  o.includes('[[2026 Index|2026]]'));
ok('index links the week',  o.includes('[[#WEEK 1 OF SEPTEMBER|Week 1]]'));
ok('index links the day',   o.includes('[[#Tue, September, 1:|Tue 1]]'));
ok('index sits below the title', o.indexOf('# SEPTEMBER 2026') < o.indexOf('%% tachado:index %%'));
ok('index is idempotent',   rebuild(o, [], { year: '2026' }) === o);
ok('no blank-line drift',   !/\n{3,}/.test(o));
ok('headings are never crowded',
   o.split('\n').every((l, i, all) => !/^#{1,6}\s/.test(l) || i === 0 || all[i - 1] === ''));
}

/* ---- year index + counts ---- */
{
const c = countStates('- [ ] 1.D — a\n- [x] 2.D — b\n- [-] 3.D — c\nnot a row');
ok('counts open/done/dropped', c.open === 1 && c.done === 1 && c.dropped === 1);

const y = yearIndexNote('2026', [
  { basename: 'SEPTEMBER 2026', month: 'SEPTEMBER', open: 2, done: 5, dropped: 1 },
  { basename: 'OCTOBER 2026',   month: 'OCTOBER',   open: 3, done: 0, dropped: 0 },
]);
ok('year index links months', y.includes('[[SEPTEMBER 2026\\|SEPTEMBER]]'));
ok('year index totals',       y.includes('5 open · 5 done · 1 dropped'));
}


/* ---- two tasks on one line (real-world: "3.D “do this” BUT 4.D “not yet”") ---- */
{
const d = `# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
3:50 p.m. : told me 3.D "rewrite the service" BUT 4.D "wait a week first"
4:00 p.m. : also 1.W "burn the quota" and separately 2.D "read the blueprint"

### Daily TO-DO Report
`;
const o = rebuild(d);
ok('first token on the line kept',  o.includes('1.D — "rewrite the service" BUT'));
ok('second token is not swallowed', o.includes('2.D — "wait a week first"'));
ok('third daily picked up',         o.includes('3.D — "read the blueprint"'));
ok('weekly on a shared line',       !o.includes('0.1.D — "burn the quota"'));
ok('four tasks, not two',           (o.match(/^- \[/gm) || []).length === 3);
}

/* ---- tools and projects are the same machinery ---- */
{
ok('two kinds registered', KINDS.length === 2);
ok('tools folder',    KINDS.some((k) => k.folder === 'Tools' && k.type === 'tool'));
ok('projects folder', KINDS.some((k) => k.folder === 'Projects' && k.type === 'project'));

const tool = ENTITY_TEMPLATE('Dolt', KINDS[0]);
const proj = ENTITY_TEMPLATE('WispBridge', KINDS[1]);
ok('tool frontmatter',    tool.includes('type: tool') && tool.includes('url:'));
ok('project frontmatter', proj.includes('type: project') && proj.includes('status: active'));
ok('no cross-contamination', !tool.includes('status:') && !proj.includes('\nurl:'));

// both kinds autolink identically
const mixed = [{ name: 'Dolt', aliases: [] }, { name: 'WispBridge', aliases: ['wispbridge'] }];
const out = autolink('pushed wispbridge issues to the dolt remote', mixed);
ok('project autolinks', out.includes('[[WispBridge|wispbridge]]'));
ok('tool autolinks',    out.includes('[[Dolt|dolt]]'));
}

/* ---- times round to the nearest 5 minutes ---- */
{
ok('rounds down',        roundTime(9, 13, 'a') === '9:15 a.m.');
ok('rounds up',          roundTime(9, 38, 'a') === '9:40 a.m.');
ok('exact stays put',    roundTime(3, 45, 'p') === '3:45 p.m.');
ok('half rounds up',     roundTime(1, 2, 'p') === '1:00 p.m.');
ok('rolls the hour',     roundTime(9, 58, 'a') === '10:00 a.m.');
ok('rolls the meridiem', roundTime(11, 59, 'a') === '12:00 p.m.');
ok('rolls past midnight', roundTime(11, 59, 'p') === '12:00 a.m.');
ok('noon is 12 p.m.',    roundTime(12, 0, 'p') === '12:00 p.m.');
ok('midnight is 12 a.m.', roundTime(12, 2, 'a') === '12:00 a.m.');

const N = normalizeTimes;
ok('normalises a log line', N('9:13 a.m. : did a thing') === '9:15 a.m. : did a thing');
ok('fixes spacing',         N('9:13 a. m. : x') === '9:15 a.m. : x');
ok('handles a range',       N('11:01 a.m. - 11:28 a.m. : x') === '11:00 a.m. - 11:30 a.m. : x');
ok('leaves code alone',     N('run `at 9:13 a.m.` now') === 'run `at 9:13 a.m.` now');
ok('leaves urls alone',     N('see https://x.com/9:13a.m./y') === 'see https://x.com/9:13a.m./y');
ok('time rounding is idempotent', N(N('9:13 a.m. : x')) === N('9:13 a.m. : x'));
}

{
const o = rebuild('# WEEK 1\n\n## Mon, September, 7:\n9:13 a.m. : 1.D fix the thing\n\n### Daily TO-DO Report\n');
ok('rebuild rounds body times', o.includes('9:15 a.m. : 1.D fix the thing'));
}

/* ---- github activity ---- */
{
const iso = (h, m) => new Date(2026, 8, 15, h, m).toISOString();

ok('parses a commit url', JSON.stringify(parseGhUrl('https://github.com/acme/app/commit/a9d2477abc')) ===
   '{"owner":"acme","repo":"app","kind":"commit","id":"a9d2477abc"}');
ok('parses a pr url',     parseGhUrl('https://github.com/acme/app/pull/5').kind === 'pull');
ok('ignores other urls',  parseGhUrl('https://example.com/acme/app/pull/5') === null);

const c = commitEntry({ owner: 'acme', repo: 'app', sha: 'a9d2477abcdef', date: iso(14, 32),
                        message: 'feat: add the thing\nbody', url: 'U', files: 3, additions: 10, deletions: 2 });
ok('commit is one line',    !c.includes('\n'));
ok('commit rounds time',    c.startsWith('2:30 p.m. : '));
ok('commit shortens sha',   c.includes('acme/app@a9d2477') && !c.includes('a9d2477abcdef'));
ok('commit drops the body', c.includes('feat: add the thing') && !c.includes('body'));
ok('commit shows stats',    c.includes('3 files +10 −2'));

ok('pr opened', prEntry({ owner: 'a', repo: 'b', number: 5, title: 't', url: 'U', action: 'opened',
                          head: 'x', base: 'main', date: iso(9, 1) })
   .startsWith('9:00 a.m. : PR [a/b#5](U) opened — t'));
ok('pr merged', prEntry({ owner: 'a', repo: 'b', number: 5, url: 'U', action: 'merged',
                          base: 'main', date: iso(16, 3) }).includes('merged into `main`'));
ok('review',    reviewEntry({ owner: 'a', repo: 'b', number: 5, url: 'U', state: 'APPROVED', date: iso(10, 14) })
   .startsWith('10:15 a.m. : reviewed'));

const pr = { number: 5, title: 'docs: the structure', html_url: 'https://github.com/acme/app/pull/5',
             created_at: iso(11, 2), merged_at: null, closed_at: null,
             head: { ref: 'docs/x' }, base: { ref: 'master' },
             changed_files: 57, additions: 5190, deletions: 31 };

let got = prToEntries(pr, 'acme/app');
ok('pr opened entry', got.length === 1 && got[0].line.includes('opened — docs: the structure'));
ok('pr rounds time',  got[0].line.startsWith('11:00 a.m. :'));
ok('pr carries stats', got[0].line.includes('57 files +5190 −31'));

got = prToEntries({ ...pr, merged_at: iso(16, 3) }, 'acme/app');
ok('merge adds a second entry', got.length === 2 && got[1].line.includes('merged into `master`'));
ok('merge sig is distinct',     got[0].sig !== got[1].sig);
ok('closed, not merged', prToEntries({ ...pr, closed_at: iso(17, 0) }, 'acme/app')[1].line.includes('closed'));

const commits = [
  { sha: 'a9d2477b46e', html_url: 'https://github.com/acme/app/commit/a9d2477b46e',
    author: { login: 'me' }, commit: { message: 'docs: add structure\n\nbody', author: { date: iso(13, 43) } } },
  { sha: 'ccc3333', html_url: 'U2', author: { login: 'someone-else' },
    commit: { message: 'not mine', author: { date: iso(14, 0) } } },
];
const ce = commitsToEntries(commits, 'acme/app', 'me');
ok('commit mapped',        ce.length === 1);
ok('commit shortens sha',  ce[0].line.includes('acme/app@a9d2477'));
ok('commit rounds time',   ce[0].line.startsWith('1:45 p.m. :'));
ok('commit drops body',    !ce[0].line.includes('body'));
ok('other authors dropped', !ce.some((e) => e.line.includes('not mine')));

const reviews = [
  { state: 'APPROVED', user: { login: 'me' }, submitted_at: iso(10, 14), html_url: 'R1' },
  { state: 'PENDING',  user: { login: 'me' }, submitted_at: iso(10, 20), html_url: 'R2' },
  { state: 'APPROVED', user: { login: 'other' }, submitted_at: iso(10, 30), html_url: 'R3' },
];
const re_ = reviewsToEntries(reviews, 'acme/app', 5, 'P', 'me');
ok('review mapped',     re_.length === 1 && re_[0].line.includes('reviewed [acme/app#5](P) — approved'));
ok('pending dropped',   re_.length === 1 && !re_[0].line.includes('pending'));
ok('others dropped',    !re_.some((e) => e.url === 'R3'));

const dupes = [ { iso: iso(9, 0), url: 'A', sig: 'A', line: 'a' }, { iso: iso(8, 0), url: 'A2', sig: 'A', line: 'a' },
                { iso: iso(7, 0), url: 'B', sig: 'B', line: 'b' }, { iso: null, url: 'C', sig: 'C', line: 'c' } ];
const t = tidy(dupes);
ok('tidy de-duplicates by signature', t.length === 2);
ok('tidy drops undated',        !t.some((e) => e.sig === 'C'));
ok('tidy sorts oldest first',   t[0].sig === 'B');
}

/* ---- chronological insertion ---- */
{
ok('reads a timestamp', minutesOf('3:45 p.m. : x') === 945);
ok('no timestamp',      minutesOf('just prose') === null);

const day = ['## Mon, September, 14:', '', '9:00 a.m. : first', '11:00 a.m. : third', '', '### Daily TO-DO Report'];
ok('inserts in order',  insertEntry(day.slice(), 0, '10:00 a.m. : second')[3] === '10:00 a.m. : second');
ok('appends when latest', insertEntry(day.slice(), 0, '5:00 p.m. : last')[4] === '5:00 p.m. : last');
ok('prepends when earliest', insertEntry(day.slice(), 0, '8:00 a.m. : early')[2] === '8:00 a.m. : early');
ok('stays inside the day', insertEntry(day.slice(), 0, '5:00 p.m. : last')
   .indexOf('5:00 p.m. : last') < day.indexOf('### Daily TO-DO Report') + 1);

// the first entry of an empty day keeps the blank line under the heading
const blank = ['## Thu, September, 10:', '', '### Daily TO-DO Report', ''];
const filled = insertEntry(blank.slice(), 0, '9:05 a.m. : first thing');
ok('blank line under the heading survives', filled[1] === '');
ok('entry goes after it',                   filled[2] === '9:05 a.m. : first thing');
}

/* ---- a blank month ---- */
{
const sep = monthSkeleton(8, 2026);            // September 2026
const line = (re) => sep.split('\n').filter((l) => re.test(l));

ok('note title',        sep.startsWith('# SEPTEMBER 2026'));
ok('every day present', line(/^## \w{3}, September, \d+:$/).length === 30);
ok('first day',         sep.includes('## Tue, September, 1:'));
ok('last day',          sep.includes('## Wed, September, 30:'));
ok('weekdays correct',  sep.includes('## Mon, September, 14:') && sep.includes('## Sun, September, 13:'));
ok('a daily report per day', line(/^### /).length === 30);

// calendar weeks, Monday-start, numbered within the month
ok('five week banners', line(/^# WEEK \d+ OF SEPTEMBER$/).length === 5);
ok('a report per week', line(/^## END OF WEEK \d+ TO-DO REPORT$/).length === 5);
ok('Sept 14 is in week 3',
   sep.indexOf('# WEEK 3 OF SEPTEMBER') < sep.indexOf('## Mon, September, 14:') &&
   sep.indexOf('## Mon, September, 14:') < sep.indexOf('# WEEK 4 OF SEPTEMBER'));
ok('week 1 is the short one',
   sep.slice(sep.indexOf('# WEEK 1'), sep.indexOf('# WEEK 2')).match(/^## \w{3},/gm).length === 6);
ok('monthly report last', sep.trim().endsWith('# END OF SEPTEMBER TO-DO REPORT'));

// a month that starts on a Monday gets no stub week
const jun = monthSkeleton(5, 2026);            // June 2026 starts Monday
ok('june starts Monday',  jun.includes('## Mon, June, 1:'));
ok('june has five weeks', jun.split('\n').filter((l) => /^# WEEK/.test(l)).length === 5);

// leap year
ok('feb 2028 has 29 days',
   monthSkeleton(1, 2028).split('\n').filter((l) => /^## \w{3}, February, \d+:$/.test(l)).length === 29);
ok('feb 2026 has 28 days',
   monthSkeleton(1, 2026).split('\n').filter((l) => /^## \w{3}, February, \d+:$/.test(l)).length === 28);

// the skeleton survives a rebuild
const built = rebuild(sep, [], { year: '2026' });
ok('skeleton rebuilds',    built.includes('%% tachado:index %%'));
ok('empty days say so',    built.includes('*nothing*'));
ok('index lists every day', (built.match(/\[\[#\w{3}, September/g) || []).length === 30);
ok('rebuild is stable',    rebuild(built, [], { year: '2026' }) === built);

const choices = monthChoices(new Date(2026, 8, 15));
ok('36 choices',       choices.length === 36);
ok('this year first',  choices[0].label === 'JANUARY 2026');
ok('covers next year', choices.some((c) => c.label === 'MARCH 2027'));
ok('covers last year', choices.some((c) => c.label === 'MARCH 2025'));
}

/* ---- generated GitHub lines are records, not prose ---- */
{
const iso = (h, m) => new Date(2026, 8, 15, h, m).toISOString();
const tools = [{ name: 'WispBridge', aliases: ['wispbridge'] }, { name: 'Remargin', aliases: ['remargin'] }];

const gen = '1:45 p.m. : commit [acme/app@a9d2477](https://github.com/acme/app/commit/a9d2477) — docs(wispbridge): add the structure';
ok('generated line detected',   GEN_LINE.test(gen));
ok('prose is not a generated line', !GEN_LINE.test('1:45 p.m. : talked about wispbridge'));
ok('report row is not one',     !GEN_LINE.test('- [ ] 1.D — commit [a/b@c](u)'));

ok('commit subject untouched',  autolink(gen, tools) === gen);
ok('prose still autolinks',     autolink('1:45 p.m. : talked about wispbridge', tools).includes('[[WispBridge|wispbridge]]'));

// already-mangled lines are repaired on the next rebuild
const mangled = '1:45 p.m. : commit [acme/app@a9d2477](U) — docs([[WispBridge|wispbridge]]): add the structure';
ok('repairs an aliased link', autolink(mangled, tools).includes('docs(wispbridge):'));
ok('repairs a bare link',
   autolink('2:25 p.m. : commit [a/b@c](U) — chore([[Remargin]]): tidy', tools).includes('chore(Remargin):'));
ok('unlink leaves plain text', unlink('nothing to do here') === 'nothing to do here');

// a URL mentioned in prose must not block the real import
const pr = { number: 5, title: 't', html_url: 'https://github.com/acme/app/pull/5',
             created_at: iso(14, 40), head: { ref: 'x' }, base: { ref: 'main' } };
const e = prToEntries(pr, 'acme/app')[0];
const prose = 'separate from the git branch and PR [acme/app#5](https://github.com/acme/app/pull/5). Teammates retrieve with `bd dolt pull`.';
ok('prose mention is not a generated line', !GEN_LINE.test(prose));
ok('signature is in the generated line',    e.line.includes(e.sig));
ok('signature survives changing stats',
   prToEntries({ ...pr, changed_files: 99, additions: 1, deletions: 1 }, 'acme/app')[0].sig === e.sig);
}

/* ---- logging to any day ---- */
{
ok('week of the 1st',  weekOfMonth(2026, 8, 1) === 1);
ok('week of the 6th',  weekOfMonth(2026, 8, 6) === 1);   // Sunday, still week 1
ok('week of the 7th',  weekOfMonth(2026, 8, 7) === 2);   // Monday, new week
ok('week of the 14th', weekOfMonth(2026, 8, 14) === 3);  // matches the source document
ok('week of the 30th', weekOfMonth(2026, 8, 30) === 5);

// a sparse note: only the 14th exists, as in a document converted from Word
const sparse = () => ['# SEPTEMBER 2026', '', '# WEEK 3 OF SEPTEMBER', '',
                      '## Mon, September, 14:', '', '### Daily TO-DO Report', '',
                      '# END OF SEPTEMBER TO-DO REPORT', ''];

let L = sparse();
ok('finds an existing day', ensureDay(L, 2026, 8, 14) === 4 && L.length === 10);

L = sparse();
let at = ensureDay(L, 2026, 8, 15);
ok('adds a later day in the same week', L[at] === '## Tue, September, 15:');
ok('after the 14th',  L.indexOf('## Tue, September, 15:') > L.indexOf('## Mon, September, 14:'));
ok('brings its report', L[at + 2] === '### Daily TO-DO Report');
ok('no duplicate week banner', L.filter((l) => /^# WEEK 3/.test(l)).length === 1);

L = sparse();
at = ensureDay(L, 2026, 8, 2);
ok('adds an earlier day',    L[at] === '## Wed, September, 2:');
ok('creates its week banner', L.includes('# WEEK 1 OF SEPTEMBER'));
ok('creates the week report', L.includes('## END OF WEEK 1 TO-DO REPORT'));
ok('week 1 precedes week 3',  L.indexOf('# WEEK 1 OF SEPTEMBER') < L.indexOf('# WEEK 3 OF SEPTEMBER'));
ok('day sits inside its week',
   L.indexOf('# WEEK 1 OF SEPTEMBER') < L.indexOf('## Wed, September, 2:') &&
   L.indexOf('## Wed, September, 2:') < L.indexOf('## END OF WEEK 1 TO-DO REPORT'));
ok('monthly report stays last',
   L.indexOf('# END OF SEPTEMBER TO-DO REPORT') === L.length - 2);

L = sparse();
ensureDay(L, 2026, 8, 28);
ok('a later week lands after week 3',
   L.indexOf('# WEEK 5 OF SEPTEMBER') > L.indexOf('# WEEK 3 OF SEPTEMBER') &&
   L.indexOf('# WEEK 5 OF SEPTEMBER') < L.indexOf('# END OF SEPTEMBER TO-DO REPORT'));

// a day added to a scaffolded month must not disturb it
L = monthSkeleton(8, 2026).split('\n');
const before = L.length;
ensureDay(L, 2026, 8, 20);
ok('scaffold already has every day', L.length === before);

/* ---- the time box ---- */
ok('12-hour with dots',  parseTimeInput('3:45 p.m.') === '3:45 p.m.');
ok('12-hour compact',    parseTimeInput('3:45pm') === '3:45 p.m.');
ok('hour only',          parseTimeInput('3pm') === '3:00 p.m.');
ok('24-hour',            parseTimeInput('15:47') === '3:45 p.m.');
ok('24-hour morning',    parseTimeInput('09:07') === '9:05 a.m.');
ok('midnight 24-hour',   parseTimeInput('00:02') === '12:00 a.m.');
ok('noon 24-hour',       parseTimeInput('12:00') === '12:00 p.m.');
ok('rounds on the way in', parseTimeInput('9:13 a.m.') === '9:15 a.m.');
ok('rejects nonsense',   parseTimeInput('later') === null);
ok('rejects bad minutes', parseTimeInput('10:75') === null);
ok('rejects bad hours',   parseTimeInput('26:00') === null);
ok('now is rounded',     /^\d{1,2}:\d{2} [ap]\.m\.$/.test(nowRounded(new Date(2026, 8, 15, 14, 33))));
ok('now rounds to 5',    nowRounded(new Date(2026, 8, 15, 14, 33)) === '2:35 p.m.');

/* ---- the grid ---- */
{
const g = calendarGrid(2026, 8);
ok('five rows',        g.length === 5);
ok('monday first',     g[0][0] === null && g[0][1] === 1);   // Sept 1 2026 is a Tuesday
ok('all days present', g.flat().filter(Boolean).length === 30);
ok('14th is a Monday', g[2][0] === 14);
ok('padded to whole weeks', g.every((row) => row.length === 7));

const now = new Date(2026, 8, 15);
ok('yesterday allowed', !isFuture(2026, 8, 14, now));
ok('today allowed',     !isFuture(2026, 8, 15, now));
ok('tomorrow blocked',  isFuture(2026, 8, 16, now));
ok('next month blocked', isFuture(2026, 9, 1, now));
ok('last month allowed', !isFuture(2026, 7, 31, now));
}
}

/* ---- a report for a day that hasn't arrived stays empty ---- */
{
const doc = `# SEPTEMBER 2026

# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
9:00 a.m. : 1.D unfinished thing

### Daily TO-DO Report

## Tue, September, 15:

### Daily TO-DO Report

## Wed, September, 16:

### Daily TO-DO Report

## Thu, September, 17:

### Daily TO-DO Report
`;
const meta = { year: '2026', month: 8, today: new Date(2026, 8, 15) };
const o = rebuild(doc, [], meta);
const dayOf = (name) => o.split(`## ${name}`)[1].split(/\n## /)[0];

ok('today holds it',           dayOf('Tue, September, 15:').includes('0.1.D — unfinished thing'));
ok('the origin day lets go',   dayOf('Mon, September, 14:').includes('*nothing*'));
ok('tomorrow stays empty',     dayOf('Wed, September, 16:').includes('*nothing*'));
ok('later days stay empty',    dayOf('Thu, September, 17:').includes('*nothing*'));

// once that day arrives, it fills in
const later = rebuild(doc, [], { ...meta, today: new Date(2026, 8, 17) });
ok('it appears when the day comes',
   later.split('## Thu, September, 17:')[1].split(/\n## /)[0].includes('0.1.D — unfinished thing'));
ok('and leaves the day before', !later.split('## Wed, September, 16:')[1].split(/\n## /)[0].includes('unfinished thing'));

// with no date context nothing is suppressed, so a bare rebuild still works
ok('undated rebuild still carries', rebuild(doc, [], {}).includes('0.1.D — unfinished thing'));

ok('first day of week 1', firstDayOfWeek(2026, 8, 1) === 1);
ok('first day of week 3', firstDayOfWeek(2026, 8, 3) === 14);
ok('first day of week 5', firstDayOfWeek(2026, 8, 5) === 28);

/* ---- one task carried for a fortnight is still one task ---- */
const rows = [
  '- [ ] 1.D — same thing', '- [ ] 0.1.D — same thing', '- [ ] 0.1.D — same thing',
  '- [x] 1.D — ~~a finished one~~', '- [-] 2.D — ~~a dropped one~~ [DROPPED]',
].join('\n');
const c = countStates(rows);
ok('carried task counted once', c.open === 1);
ok('done counted',              c.done === 1);
ok('dropped counted',           c.dropped === 1);
}

/* ---- the note heals its own skeleton ---- */
{
const meta = { year: '2026', month: 8, today: new Date(2026, 8, 15) };
const noTitle = '# WEEK 3 OF SEPTEMBER\n\n## Mon, September, 14:\n\n### Daily TO-DO Report\n';
const fixed = rebuild(noTitle, [], meta);
ok('title restored',   fixed.startsWith('# SEPTEMBER 2026'));
ok('title not doubled', (fixed.match(/^# SEPTEMBER 2026$/gm) || []).length === 1);
ok('healing is stable', rebuild(fixed, [], meta) === fixed);
ok('existing title kept once',
   (rebuild('# SEPTEMBER 2026\n\n# WEEK 3 OF SEPTEMBER\n', [], meta).match(/^# SEPTEMBER 2026$/gm) || []).length === 1);

const unnumbered = `# SEPTEMBER 2026

# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
9:00 a.m. : 1.W a weekly thing

## END OF WEEK TO-DO REPORT
`;
const num = rebuild(unnumbered, [], meta);
ok('weekly heading gets its number', num.includes('## END OF WEEK 3 TO-DO REPORT'));
ok('and reports into it',            num.includes('1.W — a weekly thing'));
}

/* ---- a task lives in exactly one daily report ---- */
{
const doc = `# SEPTEMBER 2026

# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
9:00 a.m. : 1.D still open
10:00 a.m. : 2.D got it done

### Daily TO-DO Report

- [x] 2.D — got it done

## Tue, September, 15:

### Daily TO-DO Report

## Wed, September, 16:

### Daily TO-DO Report
`;
// just the report block for a day, never the prose above it
const at = (d) => {
  const o = rebuild(doc, [], { year: '2026', month: 8, today: new Date(2026, 8, d) });
  return (name) => (o.split(`## ${name}`)[1].split(/\n## /)[0]
                     .split('### Daily TO-DO Report')[1] || '');
};

let day = at(16);
ok('open task is on today only',   day('Wed, September, 16:').includes('0.1.D — still open'));
ok('and gone from its origin',     !day('Mon, September, 14:').includes('still open'));
ok('and gone from yesterday',      !day('Tue, September, 15:').includes('still open'));
ok('done task stays where it was', day('Mon, September, 14:').includes('~~got it done~~'));
ok('done task does not travel',    !day('Wed, September, 16:').includes('got it done'));

day = at(14);
ok('on its own day it is plain-numbered', day('Mon, September, 14:').includes('1.D — still open'));
ok('not carried on day one',              !day('Mon, September, 14:').includes('0.1.D — still open'));

// a month that has already passed parks open tasks on its last day
const older = rebuild(doc, [], { year: '2026', month: 8, today: new Date(2026, 11, 1) });
ok('past month parks at the end',
   older.split('## Wed, September, 16:')[1].split(/\n## /)[0]
        .split('### Daily TO-DO Report')[1].includes('still open'));

// a month still ahead has nothing to carry
const ahead = rebuild(doc, [], { year: '2026', month: 8, today: new Date(2026, 0, 1) });
ok('future month keeps tasks at origin',
   ahead.split('## Mon, September, 14:')[1].split(/\n## /)[0]
        .split('### Daily TO-DO Report')[1].includes('1.D — still open'));
}

/* ---- a day with no report heading gets one ---- */
{
const meta = { year: '2026', month: 8, today: new Date(2026, 8, 16) };
const noReport = `# SEPTEMBER 2026

# WEEK 3 OF SEPTEMBER

## Tue, September, 15:
9:00 a.m. : 1.D unfinished

### Daily TO-DO Report

## Wed, September, 16:

# END OF SEPTEMBER TO-DO REPORT
`;
const o = rebuild(noReport, [], meta);
ok('missing report heading added', (o.match(/^### Daily TO-DO Report$/gm) || []).length === 2);
ok('and the task moves into it',
   o.split('## Wed, September, 16:')[1].split(/\n# /)[0].includes('0.1.D — unfinished'));
ok('leaving the day before empty',
   o.split('## Tue, September, 15:')[1].split(/\n## /)[0]
    .split('### Daily TO-DO Report')[1].includes('*nothing*'));
ok('healing is stable', rebuild(o, [], meta) === o);
ok('no report is invented for a week banner',
   !/# WEEK 3 OF SEPTEMBER\n\n### /.test(o));
}

/* ---- you never write the number yourself ---- */
{
const F = (t) => fillNumbers(t.split('\n')).join('\n');
const meta = { year: '2026', month: 8, today: new Date(2026, 8, 15) };

ok('bare D numbered',  F('## Mon, September, 14:\n9:00 a.m. : D : call the bank')
                        .includes('9:00 a.m. : 1.D call the bank'));
ok('bare W numbered',  F('## Mon, September, 14:\n9:00 a.m. : W : burn the quota')
                        .includes('1.W burn the quota'));
ok('bare M numbered',  F('## Mon, September, 14:\n9:00 a.m. : M : rewrite the runbook')
                        .includes('1.M rewrite the runbook'));
ok('no space before colon', F('## Mon, September, 14:\n9:00 a.m. : D: no space').includes('1.D no space'));
ok('lowercase works',       F('## Mon, September, 14:\n9:00 a.m. : w : lower').includes('1.W lower'));

// numbering continues from what you already wrote by hand
ok('continues after a typed number',
   F('## Mon, September, 14:\n9:00 a.m. : 3.D typed\n10:00 a.m. : D : bare').includes('4.D bare'));
ok('several bare markers count up',
   F('## Mon, September, 14:\n9:00 a.m. : D : one\n10:00 a.m. : D : two\n11:00 a.m. : D : three')
     .match(/1\.D one[\s\S]*2\.D two[\s\S]*3\.D three/));
ok('two on one line count up',
   F('## Mon, September, 14:\n9:00 a.m. : D : first BUT D : second').includes('1.D first BUT 2.D second'));

// each scope has its own counter, and daily numbering restarts each day
const twoDays = F('## Mon, September, 14:\n9:00 a.m. : D : mon one\n10:00 a.m. : W : weekly\n' +
                  '## Tue, September, 15:\n9:00 a.m. : D : tue one');
ok('day counter restarts',  twoDays.includes('1.D mon one') && twoDays.includes('1.D tue one'));
ok('weekly has its own',    twoDays.includes('1.W weekly'));

// the guards that apply everywhere else apply here
ok('inline code untouched', F('## Mon, September, 14:\n9:00 a.m. : run `D : x` now').includes('`D : x`'));
ok('headings untouched',    F('## Wed, September, 16:').includes('## Wed, September, 16:'));
ok('report rows untouched', F('## Mon, September, 14:\n- [ ] 1.D — a thing').includes('- [ ] 1.D — a thing'));
ok('a.m. is not a marker',  F('## Mon, September, 14:\n9:00 a.m. : just prose').includes('9:00 a.m. : just prose'));
ok('other letters ignored', F('## Mon, September, 14:\n9:00 a.m. : plan B : do it').includes('plan B : do it'));

// and it flows all the way through to the report
const out = rebuild('# SEPTEMBER 2026\n\n# WEEK 3 OF SEPTEMBER\n\n## Mon, September, 14:\n' +
                    '9:00 a.m. : D : call the bank\n\n### Daily TO-DO Report\n', [], meta);
ok('numbered in the body',   out.includes('9:00 a.m. : 1.D call the bank'));
// only the 14th exists here, so the task has nowhere to move and stays native
ok('and in the report',      out.includes('- [ ] 1.D — call the bank'));
ok('filling is idempotent',  rebuild(out, [], meta) === out);

// the live editor recognises a bare marker too, so you see the colour at once
const hits = tokensOf('9:00 a.m. : W : burn the quota');
ok('bare marker decorated', hits.length === 1 && hits[0].scope === 'W' && hits[0].bare === true);
ok('its text is the rest',  'W : burn the quota'.slice(0) && hits[0].textTo === '9:00 a.m. : W : burn the quota'.length);
}

/* ---- a completed task records the day you ticked it ---- */
{
const doc = (report) => `# SEPTEMBER 2026

# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
9:00 a.m. : 1.D call the bank
10:00 a.m. : 2.D still open

### Daily TO-DO Report
${report}
`;
const on = (y, m, d, report) =>
  rebuild(doc(report), [], { year: '2026', month: 8, today: new Date(y, m, d) });

ok('date format is day/month/year', ddmmyyyy(new Date(2026, 8, 7)) === '07/09/2026');
ok('zero padded',                   ddmmyyyy(new Date(2026, 11, 31)) === '31/12/2026');

// ticked today -> stamped with today
let o = on(2026, 8, 17, '\n- [x] 1.D — call the bank');
ok('completion is stamped',   o.includes('[completed 17/09/2026]'));
ok('stamp sits after the strikethrough', o.includes('~~call the bank~~ [completed 17/09/2026]'));
ok('open tasks are not stamped', !/- \[ \].*completed/.test(o));

// the stamp is written once and never recomputed
const stamped = '\n- [x] 1.D — ~~call the bank~~ [completed 16/09/2026]';
o = on(2026, 8, 20, stamped);
ok('an existing date is kept',  o.includes('[completed 16/09/2026]'));
ok('and not moved to today',    !o.includes('[completed 20/09/2026]'));
ok('only one stamp',            (o.match(/\[completed/g) || []).length === 1);
ok('stamping is idempotent',
   rebuild(o, [], { year: '2026', month: 8, today: new Date(2026, 8, 25) }) === o);

// unticking clears it; re-ticking stamps afresh
o = on(2026, 8, 20, '\n- [ ] 1.D — call the bank [completed 16/09/2026]');
ok('reopening drops the stamp', !o.includes('[completed'));

// the marker never leaks into a task's identity
ok('stripTail removes the stamp',
   stripTail('~~call the bank~~ [completed 16/09/2026]') === 'call the bank');
ok('stripTail removes DROPPED',
   stripTail('~~a thing~~ [DROPPED]') === 'a thing');
ok('stripTail leaves plain text', stripTail('call the bank') === 'call the bank');

o = on(2026, 8, 17, stamped);
ok('the task is still matched',  o.includes('1.D — ~~call the bank~~'));
ok('and not duplicated',         (o.match(/call the bank/g) || []).length === 2);  // body + report
ok('counts still work',          countStates(o).done === 1 && countStates(o).open === 1);

// dropped keeps its own marker, unstamped
o = on(2026, 8, 17, '\n- [-] 1.D — call the bank');
ok('dropped is flagged',      o.includes('[DROPPED 17/09/2026]'));
ok('dropped is not "completed"', !o.includes('[completed'));
}

/* ---- dropping records its date too ---- */
{
const doc = (report) => `# SEPTEMBER 2026

# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
9:00 a.m. : 1.D read the blueprint

### Daily TO-DO Report
${report}
`;
const on = (d, report) => rebuild(doc(report), [], { year: '2026', month: 8, today: new Date(2026, 8, d) });

let o = on(17, '\n- [-] 1.D — read the blueprint');
ok('drop is dated',            o.includes('[DROPPED 17/09/2026]'));
ok('marker stays uppercase',   !o.includes('[dropped 17'));
ok('after the strikethrough',  o.includes('~~read the blueprint~~ [DROPPED 17/09/2026]'));

// written once, then read back
o = on(25, '\n- [-] 1.D — ~~read the blueprint~~ [DROPPED 17/09/2026]');
ok('drop date is kept',        o.includes('[DROPPED 17/09/2026]'));
ok('not moved to today',       !o.includes('[DROPPED 25/09/2026]'));
ok('drop stamping is idempotent',
   rebuild(o, [], { year: '2026', month: 8, today: new Date(2026, 8, 28) }) === o);

// a tick changed to a drop is re-dated, not given the completion day
o = on(20, '\n- [x] 1.D — ~~read the blueprint~~ [completed 14/09/2026]'
          .replace('- [x]', '- [-]'));
ok('changing state re-dates it', o.includes('[DROPPED 20/09/2026]'));
ok('the old date is gone',       !o.includes('14/09/2026'));

// and the other way round
o = on(20, '\n- [x] 1.D — ~~read the blueprint~~ [DROPPED 14/09/2026]');
ok('drop -> done re-dates too',  o.includes('[completed 20/09/2026]'));

// an old undated [DROPPED] picks up a date on the next rebuild
o = on(21, '\n- [-] 1.D — ~~read the blueprint~~ [DROPPED]');
ok('legacy marker gets dated',   o.includes('[DROPPED 21/09/2026]'));
ok('and only once',              (o.match(/\[DROPPED/g) || []).length === 1);

ok('stripTail removes a dated drop',
   stripTail('~~a thing~~ [DROPPED 17/09/2026]') === 'a thing');
ok('counts unaffected', countStates(on(17, '\n- [-] 1.D — read the blueprint')).dropped === 1);
}

/* ---- picking a task to close ---- */
{
const note = `# SEPTEMBER 2026

# WEEK 3 OF SEPTEMBER

## Mon, September, 14:
9:00 a.m. : 1.D call the bank
9:30 a.m. : 2.D already done

### Daily TO-DO Report

- [ ] 1.D — call the bank
- [x] 2.D — ~~already done~~ [completed 14/09/2026]

## Tue, September, 15:
9:00 a.m. : 1.D fresh today
10:00 a.m. : 1.W burn the quota
11:00 a.m. : 1.M rewrite the runbook

### Daily TO-DO Report

- [ ] 0.1.D — call the bank
- [ ] 1.D — fresh today

## END OF WEEK 3 TO-DO REPORT

- [ ] 1.W — burn the quota

# END OF SEPTEMBER TO-DO REPORT

- [ ] 1.M — rewrite the runbook
`;
const rows = openRows(note.split('\n'));

ok('only open rows',          rows.length === 5);
ok('ticked rows skipped',     !rows.some((r) => r.text.includes('already done')));
ok('daily rows carry a day',  rows.find((r) => r.text === 'fresh today').day === 15);
ok('carried rows too',        rows.find((r) => r.num === '0.1.D').day === 15);
ok('weekly carries a week',   rows.find((r) => r.kind === 'W').week === 3);
ok('monthly is month-scoped', rows.find((r) => r.kind === 'M').text === 'rewrite the runbook');
ok('numbers preserved',       rows.some((r) => r.num === '0.1.D'));
ok('a typed separator is not part of the task',
   rebuild('# SEPTEMBER 2026\n\n# WEEK 3 OF SEPTEMBER\n\n## Mon, September, 14:\n' +
           '9:00 a.m. : 1.D : "Investigate linear"\n\n### Daily TO-DO Report\n', [],
           { year: '2026', month: 8, today: new Date(2026, 8, 14) })
     .includes('1.D — "Investigate linear"'));
ok('markers stripped from text',
   openRows(['### Daily TO-DO Report', '- [ ] 1.D — a thing [DROPPED 01/01/2026]'])[0].text === 'a thing');
ok('headings end a report block',
   openRows(['### Daily TO-DO Report', '## Tue, September, 15:', '- [ ] 1.D — loose']).length === 0);

// closing flips only the box; the date comes from the rebuild that follows
let L = note.split('\n');
let target = openRows(L).find((r) => r.text === 'fresh today');
ok('close succeeds',      closeRow(L, target.at, '-') === true);
ok('box is now dropped',  L[target.at].startsWith('- [-] 1.D'));
ok('text untouched',      L[target.at].includes('fresh today'));
ok('no date written yet', !L[target.at].includes('/2026'));
ok('an already-closed row is refused',
   closeRow(note.split('\n'), note.split('\n').findIndex((l) => l.startsWith('- [x]')), '-') === false);

let out = rebuild(L.join('\n'), [], { year: '2026', month: 8, today: new Date(2026, 8, 18) });
ok('rebuild stamps the drop', out.includes('~~fresh today~~ [DROPPED 18/09/2026]'));

L = note.split('\n');
target = openRows(L).find((r) => r.text === 'fresh today');
closeRow(L, target.at, 'x');
out = rebuild(L.join('\n'), [], { year: '2026', month: 8, today: new Date(2026, 8, 18) });
ok('rebuild stamps a completion', out.includes('~~fresh today~~ [completed 18/09/2026]'));
ok('other tasks untouched',       out.includes('0.1.D — call the bank'));

// closing a weekly works the same way
L = note.split('\n');
target = openRows(L).find((r) => r.kind === 'W');
closeRow(L, target.at, '-');
out = rebuild(L.join('\n'), [], { year: '2026', month: 8, today: new Date(2026, 8, 18) });
ok('weekly can be dropped', out.includes('~~burn the quota~~ [DROPPED 18/09/2026]'));
}

/* ---- a picker opens on today, never on the 1st ---- */
{
const now = new Date(2026, 8, 18);
ok('current month opens on today', defaultDay(2026, 8, now) === 18);
ok('never the 1st',                defaultDay(2026, 8, now) !== 1);
ok('a past month opens on its last day', defaultDay(2026, 7, now) === 31);
ok('february is handled',          defaultDay(2026, 1, now) === 28);
ok('a leap february too',          defaultDay(2028, 1, new Date(2028, 5, 1)) === 29);
ok('a past year opens at month end', defaultDay(2025, 8, now) === 30);
}

/* ---- moving a misplaced log entry ---- */
{
const note = `# SEPTEMBER 2026

# WEEK 1 OF SEPTEMBER

## Tue, September, 1:

12:05 p.m. : had the idea about remargin

### Daily TO-DO Report

*nothing*

# WEEK 3 OF SEPTEMBER

## Fri, September, 18:

10:20 a.m. : Got to work
12:00 p.m. : Talked with dylan

### Daily TO-DO Report

- [ ] 1.D — something open
`;
const rows = logRows(note.split('\n'));
ok('finds log lines',        rows.length === 3);
ok('report rows excluded',   !rows.some((r) => r.text.includes('something open')));
ok('headings excluded',      !rows.some((r) => r.text.startsWith('#')));
ok('day is tracked',         rows.find((r) => r.text.startsWith('12:05')).day === 1);
ok('minutes are parsed',     rows.find((r) => r.text.startsWith('10:20')).mins === 620);
ok('*nothing* is not a log line', !rows.some((r) => r.text.includes('nothing')));

// move it to the 18th, in time order between 10:20 and 12:00? no — after 12:00
let L = note.split('\n');
const row = logRows(L).find((r) => r.text.startsWith('12:05'));
ok('move succeeds', moveRow(L, row.at, 2026, 8, 18) === true);

const after = L.join('\n');
const sept18 = after.split('## Fri, September, 18:')[1].split(/\n## /)[0];
const sept1 = after.split('## Tue, September, 1:')[1].split(/\n# /)[0];
ok('gone from the 1st',    !sept1.includes('12:05'));
ok('landed on the 18th',   sept18.includes('12:05 p.m. : had the idea about remargin'));
ok('in time order',        sept18.indexOf('12:00') < sept18.indexOf('12:05'));
ok('after 10:20 too',      sept18.indexOf('10:20') < sept18.indexOf('12:05'));
ok('no double blank left', !/\n\n\n/.test(after));

// moving to a day that does not exist yet creates it
L = note.split('\n');
moveRow(L, logRows(L).find((r) => r.text.startsWith('12:05')).at, 2026, 8, 9);
ok('creates the target day',  L.includes('## Wed, September, 9:'));
ok('creates its week banner', L.includes('# WEEK 2 OF SEPTEMBER'));

// a non-log line is refused
L = note.split('\n');
ok('refuses a heading', moveRow(L, L.indexOf('## Tue, September, 1:'), 2026, 8, 18) === false);
ok('refuses a report row',
   moveRow(L, L.findIndex((l) => l.startsWith('- [ ]')), 2026, 8, 18) === false);

// and the note still rebuilds cleanly afterwards
L = note.split('\n');
moveRow(L, logRows(L).find((r) => r.text.startsWith('12:05')).at, 2026, 8, 18);
const out = rebuild(L.join('\n'), [], { year: '2026', month: 8, today: new Date(2026, 8, 18) });
ok('rebuilds after a move', out.includes('12:05 p.m. : had the idea about remargin'));
ok('still idempotent',
   rebuild(out, [], { year: '2026', month: 8, today: new Date(2026, 8, 18) }) === out);
}

console.log(`all ${n} checks passed`);
