// Self-check: run `node check.js`. Asserts the 0.N rule, promotion, demotion,
// carry-over and state preservation. No framework.
const Module = require('module');
const real = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') return { Plugin: class {}, Notice: class {} };
  if (req === '@codemirror/view') return { ViewPlugin: { fromClass: () => ({}) }, Decoration: { mark: () => ({}) } };
  if (req === '@codemirror/state') return { RangeSetBuilder: class {} };
  return real(req, ...rest);
};
const { rebuild } = require('./main.js').__test;
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
console.log(`all ${n} checks passed`);
}
