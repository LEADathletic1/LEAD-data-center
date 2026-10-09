import { h, clear, plural } from './dom.js';
import { state, setLibrary } from '../state.js';
import { bestOf, latestOf, fmtTime, countPoints } from '../stats.js';
import { foldName } from '../import/normalize.js';
import { cleanTag } from '../import/tags.js';
import { toCSV } from '../csv.js';
import { visibleSelected, bulkChips, allVisibleSelected } from '../selection.js';
import { openHistory } from './history.js';
import * as api from '../api.js';

// Remembered across visits to the screen within one page load.
const ui = { test: null, query: '', tag: 'All', browse: false, selected: new Set(), notice: '', editing: null, bulkDraft: '', tagDraft: '', error: '', busy: false };

export function render(main) {
  const lib = () => state.library;
  if (!ui.test || lib().tests.indexOf(ui.test) < 0) ui.test = lib().tests[0];

  const root = h('div', { class: 'page lib' });
  main.appendChild(root);
  const toggleBox = h('div', { class: 'toggle', role: 'group', 'aria-label': 'Test' });
  const searchInput = h('input', {
    type: 'search', class: 'input search', placeholder: 'Search athlete name...', 'aria-label': 'Search athletes', value: ui.query, autocomplete: 'off',
    oninput: (e) => { ui.query = e.target.value; listChanged(); drawResults(); },
  });
  const tagBox = h('div', { class: 'row wrap' });
  const metaBox = h('div', { class: 'mono dim small' });
  const results = h('div', { class: 'stack-lg full' });
  root.appendChild(h('div', { class: 'lib-inner' },
    h('div', { class: 'lib-top' }, toggleBox, h('button', { type: 'button', class: 'btn-ghost mono', onclick: downloadCsv }, 'DOWNLOAD CSV')),
    searchInput, tagBox, metaBox, results));

  // Selection is cleared whenever the list could have changed, so a bulk action never reaches a hidden row.
  function listChanged() { ui.selected = new Set(); ui.notice = ''; ui.error = ''; }

  function visible() {
    const q = foldName(ui.query);
    const fold = (a) => [a.name].concat(a.aliases).map(foldName);
    return lib().athletes
      .filter((a) => !q || fold(a).some((n) => n.includes(q)))
      .filter((a) => ui.tag === 'All' || a.tags.some((t) => t.toLowerCase() === ui.tag.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }
  const isListing = () => foldName(ui.query).length > 0 || ui.tag !== 'All' || ui.browse;

  function drawControls() {
    clear(toggleBox);
    for (const t of lib().tests) {
      toggleBox.appendChild(h('button', { type: 'button', class: 'toggle-btn label' + (t === ui.test ? ' on' : ''), 'aria-pressed': t === ui.test ? 'true' : 'false',
        onclick: () => { ui.test = t; ui.editing = null; listChanged(); drawControls(); drawResults(); } }, t + ' Sprint'));
    }
    clear(tagBox);
    tagBox.appendChild(h('span', { class: 'mono dim label-sm' }, 'TAG'));
    for (const t of ['All'].concat(lib().tags)) {
      tagBox.appendChild(h('button', { type: 'button', class: 'chip-btn mono' + (ui.tag === t ? ' on' : ''), 'aria-pressed': ui.tag === t ? 'true' : 'false',
        onclick: () => { ui.tag = t; ui.editing = null; listChanged(); drawControls(); drawResults(); } }, t));
    }
    const dates = new Set();
    for (const tab of Object.keys(lib().points)) for (const r of lib().points[tab]) dates.add(r[1]);
    const last = lib().lastImport && lib().lastImport.timestamp ? lib().lastImport.timestamp.slice(0, 10) : '—';
    metaBox.textContent = plural(lib().athletes.length, 'athlete') + ' on file · ' + plural(dates.size, 'test date') + ' · ' + plural(countPoints(lib()), 'data point') + ' · last import ' + last;
  }

  async function applyTags(ids, add, remove, doneMessage) {
    if (ui.busy) return;
    ui.busy = true; ui.error = ''; drawResults();
    const startVersion = ++state.version;
    try {
      const out = await api.setTags({ athlete_ids: ids, add, remove });
      const byId = new Map(out.updated.map((u) => [u.id, u.tags]));
      for (const a of lib().athletes) if (byId.has(a.id)) a.tags = byId.get(a.id);
      lib().tags = out.tags;
      ui.notice = doneMessage(out.updated.length);
      ui.bulkDraft = ''; ui.tagDraft = '';
      // Refresh in the background; drop the result if another write happened meanwhile.
      api.getLibrary().then((fresh) => { if (state.version === startVersion) { setLibrary(fresh); drawControls(); drawResults(); } }).catch(() => {});
    } catch (e) {
      ui.error = e.message;
      if (e.code === 'auth' || e.code === 'auth_expired') window.dispatchEvent(new CustomEvent('lead:auth-lost'));
    }
    ui.busy = false;
    drawControls();
    drawResults();
  }

  function bulkBar(sel) {
    const chips = bulkChips(sel, lib().tags);
    const ids = sel.map((a) => a.id);
    const input = h('input', { type: 'text', class: 'input compact', placeholder: 'New tag name...', 'aria-label': 'New tag name for selected athletes', value: ui.bulkDraft, maxlength: '60', autocomplete: 'off', oninput: (e) => { ui.bulkDraft = e.target.value; } });
    const createAndAdd = () => {
      const c = cleanTag(ui.bulkDraft);
      if (!c.ok) { ui.error = c.error; drawResults(); return; }
      applyTags(ids, [c.tag], [], (n) => 'Added ' + c.tag + ' to ' + plural(n, 'athlete'));
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createAndAdd(); } });
    return h('section', { class: 'bulk', 'aria-label': 'Bulk tag actions' },
      h('div', { class: 'row between' },
        h('div', { class: 'label card-title tight' }, sel.length + ' selected'),
        h('button', { type: 'button', class: 'btn-ghost mono small-btn', onclick: () => { ui.selected = new Set(); ui.notice = ''; drawResults(); } }, 'CLEAR SELECTION')),
      h('div', { class: 'row wrap' },
        h('span', { class: 'mono dim label-sm fixed' }, 'ADD TAG'),
        chips.add.map((c) => h('button', { type: 'button', class: 'chip-btn accent-outline mono', disabled: ui.busy, onclick: () => applyTags(ids, [c.tag], [], (n) => 'Added ' + c.tag + ' to ' + plural(n, 'athlete')) }, c.label)),
        chips.add.length === 0 ? h('span', { class: 'mono dim small' }, 'Every selected athlete already has every tag') : null,
        input,
        h('button', { type: 'button', class: 'btn-outline-soft mono small-btn', disabled: ui.busy, onclick: createAndAdd }, 'CREATE AND ADD')),
      h('div', { class: 'row wrap' },
        h('span', { class: 'mono dim label-sm fixed' }, 'REMOVE TAG'),
        chips.remove.map((c) => h('button', { type: 'button', class: 'chip-btn mono', disabled: ui.busy, onclick: () => applyTags(ids, [], [c.tag], (n) => 'Removed ' + c.tag + ' from ' + plural(n, 'athlete')) }, c.label)),
        chips.remove.length === 0 ? h('span', { class: 'mono dim small' }, 'None of the selected athletes have tags') : null),
      h('div', { class: 'mono accent small', role: 'status', 'aria-live': 'polite' }, ui.notice));
  }

  function editor() {
    const a = lib().athletes.find((x) => x.id === ui.editing);
    if (!a) return null;
    const input = h('input', { type: 'text', class: 'input compact', placeholder: 'New tag name...', 'aria-label': 'New tag name', value: ui.tagDraft, maxlength: '60', autocomplete: 'off', oninput: (e) => { ui.tagDraft = e.target.value; } });
    const addDraft = () => {
      const c = cleanTag(ui.tagDraft);
      if (!c.ok) { ui.error = c.error; drawResults(); return; }
      applyTags([a.id], [c.tag], [], () => 'Added ' + c.tag + ' to ' + a.name);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addDraft(); } });
    return h('section', { class: 'panel accent-border stack', 'aria-label': 'Edit tags for ' + a.name },
      h('div', { class: 'row between' },
        h('div', { class: 'label card-title tight' }, 'Tags for ', a.name),
        h('button', { type: 'button', class: 'btn-primary small-btn', onclick: () => { ui.editing = null; ui.tagDraft = ''; ui.notice = ''; drawResults(); } }, 'DONE')),
      h('div', { class: 'row wrap' },
        lib().tags.map((t) => {
          const on = a.tags.some((x) => x.toLowerCase() === t.toLowerCase());
          return h('button', { type: 'button', class: 'chip-btn mono' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', disabled: ui.busy,
            onclick: () => applyTags([a.id], on ? [] : [t], on ? [t] : [], () => (on ? 'Removed ' : 'Added ') + t + (on ? ' from ' : ' to ') + a.name) }, t);
        }),
        input,
        h('button', { type: 'button', class: 'btn-outline mono small-btn', disabled: ui.busy, onclick: addDraft }, 'ADD TAG')),
      h('div', { class: 'mono accent small', role: 'status', 'aria-live': 'polite' }, ui.notice));
  }

  function table(rows) {
    const selectAll = h('input', { type: 'checkbox', class: 'check-box', 'aria-label': 'Select all athletes in this list', checked: allVisibleSelected(ui.selected, rows),
      onchange: () => { if (allVisibleSelected(ui.selected, rows)) rows.forEach((a) => ui.selected.delete(a.id)); else rows.forEach((a) => ui.selected.add(a.id)); ui.notice = ''; drawResults(); } });
    selectAll.indeterminate = !selectAll.checked && rows.some((a) => ui.selected.has(a.id));
    return h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', class: 'narrow' }, selectAll),
          ['ATHLETE', 'LATEST', 'BEST (FASTEST)', 'TESTS', 'TAGS'].map((c) => h('th', { scope: 'col', class: 'mono' }, c)),
          h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Actions')))),
        h('tbody', null, rows.map((a) => {
          const pts = (state.pointIndex.get(a.id) || {})[ui.test] || [];
          const best = bestOf(pts), latest = latestOf(pts);
          const checked = ui.selected.has(a.id);
          return h('tr', { class: checked ? 'selected' : '' },
            h('td', null, h('input', { type: 'checkbox', class: 'check-box', 'aria-label': 'Select ' + a.name, checked,
              onchange: (e) => { if (e.target.checked) ui.selected.add(a.id); else ui.selected.delete(a.id); ui.notice = ''; drawResults(); } })),
            h('td', null, h('button', { type: 'button', class: 'name-btn', onclick: () => openHistory(a.id, ui.test, null) }, a.name)),
            h('td', { class: 'mono soft' }, latest ? [fmtTime(latest.time), h('span', { class: 'dim small' }, '  ' + latest.date)] : '—'),
            h('td', { class: 'mono accent' }, best ? [fmtTime(best.time), h('span', { class: 'dim small' }, '  ' + best.date)] : '—'),
            h('td', { class: 'mono soft' }, String(pts.length)),
            h('td', null, h('div', { class: 'row wrap tight' }, a.tags.map((t) => h('span', { class: 'tag-pill mono' }, t)))),
            h('td', null, h('button', { type: 'button', class: 'btn-ghost mono small-btn', onclick: () => { ui.editing = a.id; ui.notice = ''; drawResults(); } }, 'EDIT TAGS')));
        }))));
  }

  function drawResults() {
    clear(results);
    const rows = visible();
    // Bulk actions apply only to rows that are visible right now.
    const sel = visibleSelected(ui.selected, rows);
    if (ui.error) results.appendChild(h('div', { class: 'alert', role: 'alert' }, h('p', null, ui.error)));
    if (!isListing()) {
      results.appendChild(h('div', { class: 'empty' },
        h('div', { class: 'muted' }, 'Search for an athlete, or pick a tag, to see test history.'),
        h('button', { type: 'button', class: 'btn-outline mono', onclick: () => { ui.browse = true; listChanged(); drawResults(); } }, 'BROWSE ALL ATHLETES')));
      return;
    }
    if (!rows.length) { results.appendChild(h('div', { class: 'empty solid mono muted' }, 'No athlete matches this search')); return; }
    if (sel.length) results.appendChild(bulkBar(sel));
    const ed = ui.editing ? editor() : null;
    if (ed) results.appendChild(ed);
    results.appendChild(h('div', { class: 'mono dim small' }, plural(rows.length, 'athlete') + ' shown'));
    results.appendChild(table(rows));
  }

  function downloadCsv() {
    const rows = [['Athlete', 'Test', 'Date', 'Time (s)', 'Tags', 'Source']];
    const sorted = lib().athletes.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const a of sorted) {
      for (const p of (state.pointIndex.get(a.id) || {})[ui.test] || []) rows.push([a.name, ui.test, p.date, p.time.toFixed(3), a.tags.join('; '), p.source || '']);
    }
    const blob = new Blob(['﻿' + toCSV(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: 'lead-' + ui.test.toLowerCase().replace(/\s+/g, '-') + '-library-' + new Date().toISOString().slice(0, 10) + '.csv' });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  drawControls();
  drawResults();
  // Refresh in the background so the screen reflects any import done elsewhere.
  const v = state.version;
  api.getLibrary().then((fresh) => { if (state.version === v && root.isConnected) { setLibrary(fresh); drawControls(); drawResults(); } }).catch(() => {});
}
