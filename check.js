// Self-check: run `node check.js`. Asserts the 0.N rule, promotion, demotion,
// carry-over and state preservation. No framework.
const Module = require('module');
const real = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') return { Plugin: class {}, Notice: class {}, EditorSuggest: class {}, PluginSettingTab: class {}, Setting: class {}, SuggestModal: class {} };
  if (req === '@codemirror/view') return { ViewPlugin: { fromClass: () => ({}) }, Decoration: { mark: () => ({}) } };
  if (req === '@codemirror/state') return { RangeSetBuilder: class {} };
  return real(req, ...rest);
};
const T = require('./main.js').__test;
const { rebuild, autolink, yearIndexNote, countStates, ENTITY_TEMPLATE, KINDS,
        roundTime, normalizeTimes, parseGhUrl, commitEntry, prEntry, reviewEntry,
        prToEntries, commitsToEntries, reviewsToEntries, tidy, insertEntry, minutesOf,
        monthSkeleton, monthChoices } = T;
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
ok('dropped is flagged',    has(out, '- [-] 2.D — ~~abandoned one~~ [DROPPED]'));

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
ok('merge url is distinct',     got[0].url !== got[1].url);
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
ok('pending dropped',   !re_.some((e) => e.url === 'R2'));
ok('others dropped',    !re_.some((e) => e.url === 'R3'));

const dupes = [ { iso: iso(9, 0), url: 'A', line: 'a' }, { iso: iso(8, 0), url: 'A', line: 'a' },
                { iso: iso(7, 0), url: 'B', line: 'b' }, { iso: null, url: 'C', line: 'c' } ];
const t = tidy(dupes);
ok('tidy de-duplicates by url', t.length === 2);
ok('tidy drops undated',        !t.some((e) => e.url === 'C'));
ok('tidy sorts oldest first',   t[0].url === 'B');
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

console.log(`all ${n} checks passed`);
