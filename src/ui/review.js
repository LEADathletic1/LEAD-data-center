import { h, clear, mono, plural, trapDialog } from './dom.js';
import { state, resetUpload, setLibrary } from '../state.js';
import { analyze, computePlan, buildPayload } from '../import/plan.js';
import { bestOf, fmtTime } from '../stats.js';
import { TEST_TABS } from '../tests.js';
import * as api from '../api.js';

const tabLabel = (tab) => tab.replace(' Yard', ' Yard Sprint');

export function render(main) {
  const up = state.upload;
  if (!up || up.result === undefined) {
    location.hash = '#/upload';
    return;
  }
  const root = h('div', { class: 'page' });
  main.appendChild(root);
  let openKey = null;
  let busy = false;
  let error = '';
  let closeDialog = null;

  function closeModal() {
    const key = openKey;
    openKey = null;
    draw();
    const opener = key && root.querySelector('[data-pair="' + CSS.escape(key) + '"]');
    if (opener) opener.focus();
  }

  const strip = (items) => h('section', { class: 'strip', 'aria-label': 'Import summary' },
    items.map(([label, value, cls]) => h('div', { class: 'stat' },
      h('div', { class: 'mono dim label-sm' }, label),
      h('div', { class: 'mono stat-value-lg ' + (cls || '') }, String(value)))));

  async function confirm(payload) {
    busy = true; error = ''; draw();
    try {
      const out = await api.commitImport(payload);
      state.version++;
      up.result = out.result;
      busy = false;
      try { setLibrary((await api.getLibrary())); } catch { /* the Library screen refreshes on open */ }
    } catch (e) {
      busy = false;
      error = e.message;
      if (e.code === 'auth' || e.code === 'auth_expired') window.dispatchEvent(new CustomEvent('lead:auth-lost'));
    }
    draw();
  }

  function pairModal(plan, analysis) {
    const pair = analysis.pairs.find((p) => p.key === openKey);
    if (!pair) return null;
    const inc = up.parsed.records.filter((r) => r.norm === pair.norm);
    const incDates = new Set(inc.map((r) => r.date));
    const perTab = state.pointIndex.get(pair.athlete.id) || {};
    const libDates = new Set();
    const bests = [];
    for (const tab of TEST_TABS) {
      for (const p of perTab[tab] || []) libDates.add(p.date);
      const b = bestOf(perTab[tab]);
      if (b) bests.push('best ' + tab + ' ' + fmtTime(b.time));
    }
    const decide = (value) => { up.decisions[pair.key] = value; closeModal(); };
    const dlg = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === e.currentTarget) closeModal(); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' },
        h('div', { class: 'modal-head' },
          h('div', { class: 'label modal-title', id: 'modal-title' }, 'Is this the same athlete?'),
          h('div', { class: 'mono muted small' }, pair.reason)),
        h('div', { class: 'modal-cols' },
          h('div', { class: 'modal-col' },
            h('div', { class: 'mono dim label-sm' }, 'INCOMING FROM FILE'),
            h('div', { class: 'modal-name' }, pair.name),
            h('div', { class: 'mono soft small lh' }, plural(inc.length, 'data point') + ' on ' + plural(incDates.size, 'date') + ' in this file')),
          h('div', { class: 'modal-col' },
            h('div', { class: 'mono dim label-sm' }, 'ALREADY IN LIBRARY'),
            h('div', { class: 'modal-name' }, pair.athlete.name),
            h('div', { class: 'mono soft small lh' }, plural(libDates.size, 'test date') + (bests.length ? ' · ' + bests.join(' · ') : '')),
            h('div', { class: 'mono accent small' }, 'Tags: ' + (pair.athlete.tags.length ? pair.athlete.tags.join(', ') : 'none')))),
        h('div', { class: 'modal-foot' },
          h('button', { type: 'button', class: 'btn-link mono', onclick: () => closeModal() }, 'DECIDE LATER'),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn-outline-soft mono', onclick: () => decide('new') }, 'ADD AS NEW ATHLETE'),
            h('button', { type: 'button', class: 'btn-primary small-btn', onclick: () => decide('merge') }, 'Merge — Same Athlete')))));
    return dlg;
  }

  function attentionSection(plan) {
    const items = [];
    for (const a of up.parsed.athletes.filter((x) => x.invalid)) {
      const on = up.included.has(a.norm);
      items.push(h('div', { class: 'list-row' },
        h('div', { class: 'grow' },
          h('div', null, a.name, ' ', mono('· ' + plural(a.pointCount, 'data point'), 'dim small')),
          h('div', { class: 'mono dim small' }, 'Looks like an email address or placeholder profile. Held back unless you include it.')),
        h('label', { class: 'check mono small' },
          h('input', { type: 'checkbox', checked: on, onchange: (e) => { if (e.target.checked) up.included.add(a.norm); else up.included.delete(a.norm); draw(); } }),
          ' Include in import')));
    }
    for (const o of up.parsed.outliers.filter((x) => up.included.has(normOf(x.name)))) {
      items.push(h('div', { class: 'list-row' },
        h('div', { class: 'grow' }, o.name, ' ', mono('· ' + o.test + ' · ' + o.date, 'dim small')),
        h('div', { class: 'mono soft small' }, fmtTime(o.time) + ' s is outside the usual ' + o.low.toFixed(1) + '–' + o.high.toFixed(1) + ' s range'),
        h('span', { class: 'tag-pill mono' }, 'CHECK TIME')));
    }
    for (const d of up.parsed.inFileDuplicates.filter((x) => up.included.has(normOf(x.name)))) {
      items.push(h('div', { class: 'list-row' },
        h('div', { class: 'grow' }, d.name, ' ', mono('· ' + d.test + ' · ' + d.date, 'dim small')),
        h('div', { class: 'mono soft small' }, 'listed twice in the file: kept ' + fmtTime(d.kept) + ', ignored ' + fmtTime(d.discarded)),
        h('span', { class: 'tag-pill mono' }, 'LATER ROW WINS')));
    }
    if (up.parsed.blankNameRows) {
      items.push(h('div', { class: 'list-row' }, h('div', { class: 'grow' }, plural(up.parsed.blankNameRows, 'row'), ' with no athlete name ', mono('were skipped', 'dim small'))));
    }
    if (!items.length) return null;
    return h('section', { class: 'panel flush' },
      h('div', { class: 'panel-head' }, h('div', { class: 'label card-title' }, 'Needs attention'), mono('DOES NOT BLOCK THE IMPORT', 'dim label-sm')),
      items);
  }

  function normOf(name) { const a = up.parsed.athletes.find((x) => x.name === name); return a ? a.norm : ''; }

  function matchesSection(plan, analysis) {
    if (!analysis.pairs.length) return null;
    return h('section', { class: 'panel flush' },
      h('div', { class: 'panel-head' }, h('div', { class: 'label card-title' }, 'Possible name matches'), mono('DECIDE EACH BEFORE CONFIRMING', 'dim label-sm')),
      analysis.pairs.map((p) => {
        const st = plan.pairStatus.get(p.key);
        const note = st === 'merged' ? 'New spelling saved as an alias, so future exports map automatically'
          : st === 'new' ? 'Kept as a separate athlete, and this pair will not be flagged again'
          : st === 'skipped' ? 'Not needed: this name was merged into another athlete'
          : p.reason;
        return h('div', { class: 'list-row' },
          h('div', { class: 'grow' },
            h('div', { class: 'match-line' }, p.name, ' ', mono('may be', 'dim small'), ' ', p.athlete.name),
            h('div', { class: 'mono dim small' }, note)),
          h('span', { class: 'status mono' + (st === 'pending' ? '' : ' done') }, st === 'merged' ? 'MERGED' : st === 'new' ? 'ADDED AS NEW' : st === 'skipped' ? 'SKIPPED' : 'PENDING'),
          st === 'skipped' ? null : h('button', { type: 'button', class: 'btn-outline mono', 'data-pair': p.key, onclick: () => { openKey = p.key; draw(); } }, st === 'pending' ? 'REVIEW' : 'CHANGE'));
      }));
  }

  function correctionsSection(plan) {
    if (!plan.corrections.length) return null;
    return h('section', { class: 'panel flush' },
      h('div', { class: 'panel-head' }, h('div', { class: 'label card-title' }, 'Time corrections'), mono('SAME ATHLETE, TEST AND DATE — NEW TIME REPLACES THE OLD ONE', 'dim label-sm')),
      plan.corrections.map((c) => h('div', { class: 'list-row' },
        h('div', { class: 'grow' }, c.name, ' ', mono('· ' + c.test + ' · ' + c.date, 'dim small')),
        h('div', { class: 'mono soft small' }, 'previous ' + fmtTime(c.previous) + ' · new ' + fmtTime(c.next)),
        h('span', { class: 'tag-pill ok mono' }, 'UPDATED TO NEW TIME'))));
  }

  function done(r) {
    return h('div', { class: 'stack-lg' },
      h('div', { class: 'success', role: 'status' },
        h('div', { class: 'label card-title' }, 'Import complete'),
        h('p', { class: 'muted small' }, 'These are the authoritative counts from the server. The raw file is archived.')),
      strip([
        ['NEW DATA POINTS', r.newPoints, 'accent'], ['DUPLICATES SKIPPED', r.duplicates], ['TIME CORRECTIONS', r.corrections],
        ['NEW ATHLETES', r.newAthletes], ['NAME MATCHES DECIDED', r.matchesMerged + r.matchesAddedAsNew],
      ]),
      h('div', { class: 'grid-2' },
        h('div', { class: 'panel' },
          h('div', { class: 'label card-title tight' }, 'By test'),
          TEST_TABS.filter((t) => r.perTest[t] && (r.perTest[t].new || r.perTest[t].duplicates || r.perTest[t].corrected)).map((t) =>
            h('div', { class: 'kv' }, h('span', null, tabLabel(t)), mono(r.perTest[t].new + ' new · ' + r.perTest[t].duplicates + ' duplicates' + (r.perTest[t].corrected ? ' · ' + r.perTest[t].corrected + ' corrected' : ''), 'soft small')))),
        h('div', { class: 'panel' },
          h('div', { class: 'label card-title tight' }, 'Tags applied'),
          h('div', { class: 'row wrap' }, r.tags.map((t) => h('span', { class: 'chip chip-on mono' }, t))),
          h('p', { class: 'muted small' }, 'Applied to ' + plural(r.athletesInFile, 'athlete') + ' in this file.'))),
      h('div', { class: 'cta-row' },
        h('button', { type: 'button', class: 'btn-ghost mono', onclick: () => { resetUpload(); location.hash = '#/upload'; } }, 'IMPORT ANOTHER FILE'),
        h('a', { class: 'btn-primary', href: '#/library' }, 'Open Library →')));
  }

  function draw() {
    if (closeDialog) { closeDialog(); closeDialog = null; }
    clear(root);
    const lib = state.library;
    const analysis = analyze(up.parsed, lib, up.included);
    const plan = computePlan(up.parsed, lib, analysis, up.decisions);
    const tests = up.parsed.tests.map((t) => t.label).join(' + ');

    root.appendChild(h('div', { class: 'content' },
      h('div', null,
        h('h2', { class: 'screen-title' }, 'Review Import'),
        h('div', { class: 'mono muted' }, up.fileName + ' · ' + tests))));

    if (up.result) { root.firstChild.appendChild(done(up.result)); return; }

    const body = root.firstChild;
    const c = plan.counts;
    body.appendChild(strip([
      ['NEW DATA POINTS', c.newPoints, 'accent'], ['DUPLICATES SKIPPED', c.duplicates], ['TIME CORRECTIONS', c.corrections],
      ['NEW ATHLETES', c.newAthletes], ['NAME MATCHES TO REVIEW', c.pendingMatches, c.pendingMatches === 0 ? 'accent' : ''],
    ]));
    if (plan.pendingPoints) body.appendChild(h('div', { class: 'mono dim small' }, plural(plan.pendingPoints, 'data point') + ' belong to undecided name matches and are not counted yet.'));

    body.appendChild(h('div', { class: 'grid-2' },
      h('section', { class: 'panel' },
        h('div', { class: 'label card-title tight' }, 'By test'),
        up.parsed.tests.map((t) => {
          const p = plan.perTest[t.tab];
          return h('div', { class: 'kv' }, h('span', null, t.label), mono(p.new + ' new · ' + p.duplicates + ' duplicates' + (p.corrected ? ' · ' + p.corrected + ' corrected' : ''), 'soft small'));
        })),
      h('section', { class: 'panel' },
        h('div', { class: 'label card-title tight' }, 'Tags applied'),
        h('div', { class: 'row wrap' }, up.tags.map((t) => h('span', { class: 'chip chip-on mono' }, t))),
        h('p', { class: 'muted small' }, 'Added to all ' + plan.athletesInFile + ' athletes in this file. Tags an athlete already has stay in place.'))));

    for (const s of [matchesSection(plan, analysis), correctionsSection(plan), attentionSection(plan)]) if (s) body.appendChild(s);

    if (error) body.appendChild(h('div', { class: 'alert', role: 'alert' }, h('div', { class: 'label alert-title' }, 'Import was not written'), h('p', null, error)));

    const label = 'Confirm Import — Write ' + plural(c.newPoints, 'Row');
    const canGo = plan.canConfirm && !busy && up.tags.length > 0;
    body.appendChild(h('div', { class: 'footer-row' },
      h('a', { class: 'link-muted', href: '#/upload' }, '← Back and change file'),
      h('div', { class: 'row' },
        c.pendingMatches > 0 ? h('span', { class: 'mono muted small', id: 'confirm-why' }, 'Resolve ' + c.pendingMatches + ' name match(es) to confirm') : null,
        analysis.entries.length === 0 ? h('span', { class: 'mono muted small', id: 'confirm-why' }, 'No athletes are included in this import') : null,
        h('button', {
          type: 'button', class: 'btn-primary', disabled: !canGo, 'aria-describedby': canGo ? null : 'confirm-why',
          onclick: () => confirm(buildPayload(up.parsed, analysis, up.decisions, up.tags, up.csv)),
        }, busy ? 'Writing…' : label))));

    if (openKey) {
      const modal = pairModal(plan, analysis);
      if (modal) {
        body.appendChild(modal);
        closeDialog = trapDialog(modal.firstChild, () => closeModal());
      }
    }
  }
  draw();
}
