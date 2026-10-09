import { h, clear, mono, plural } from './dom.js';
import { state, resetUpload } from '../state.js';
import { parseLumin, ImportBlockedError } from '../parsers/lumin.js';
import { cleanTag } from '../import/tags.js';
import { countPoints } from '../stats.js';
import * as api from '../api.js';

const MAX_BYTES = 20 * 1024 * 1024;

export function render(main) {
  let blocked = null; // messages from a file that could not be loaded
  let tagError = '';
  let dragging = false;
  const root = h('div', { class: 'page' });
  main.appendChild(root);

  const canonical = (tag) => {
    const known = (state.library.tags || []).find((t) => t.toLowerCase() === tag.toLowerCase());
    return known || tag;
  };

  async function loadText(name, text) {
    blocked = null;
    try {
      const parsed = parseLumin(text, name);
      resetUpload();
      state.upload = { fileName: name, csv: text, parsed, tags: [], included: new Set(parsed.athletes.filter((a) => !a.invalid).map((a) => a.norm)), decisions: {}, result: null };
    } catch (e) {
      blocked = e instanceof ImportBlockedError ? e.messages : ['This file could not be read: ' + e.message];
    }
    draw();
  }

  async function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_BYTES) { blocked = ['That file is larger than 20 MB, which is far beyond a Lumin export. Choose a different file.']; draw(); return; }
    await loadText(file.name, await file.text());
  }

  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', onchange: (e) => { loadFile(e.target.files[0]); e.target.value = ''; } });

  function stats() {
    const lib = state.library;
    const last = lib.lastImport && lib.lastImport.timestamp ? new Date(lib.lastImport.timestamp) : null;
    const cell = (label, value, accent) => h('div', { class: 'stat' }, h('div', { class: 'mono dim label-sm' }, label), h('div', { class: 'mono stat-value' + (accent ? ' accent' : '') }, value));
    return h('section', { class: 'stats', 'aria-label': 'Library snapshot' },
      cell('ATHLETES ON FILE', String(lib.athletes.length)),
      cell('DATA POINTS STORED', String(countPoints(lib))),
      cell('LAST IMPORT', last && !isNaN(last) ? last.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : '—', true),
      cell('TESTS TRACKED', String(lib.tests.length)));
  }

  function dropZone() {
    const zone = h('button', {
      type: 'button', class: 'dropzone' + (dragging ? ' dragging' : ''),
      onclick: () => fileInput.click(),
      ondragover: (e) => { e.preventDefault(); if (!dragging) { dragging = true; zone.classList.add('dragging'); } },
      ondragleave: () => { dragging = false; zone.classList.remove('dragging'); },
      ondrop: (e) => { e.preventDefault(); dragging = false; zone.classList.remove('dragging'); loadFile(e.dataTransfer.files[0]); },
    },
      h('span', { class: 'dz-title' }, 'Drop CSV here or click to browse'),
      h('span', { class: 'mono dim dz-sub' }, 'Lumin Physical Testing Report export — one file can hold several tests'));
    return zone;
  }

  function tagsPanel(up) {
    const input = h('input', { type: 'text', class: 'input', placeholder: 'New tag name...', 'aria-label': 'New tag name', maxlength: '60', autocomplete: 'off' });
    const add = () => {
      const c = cleanTag(input.value);
      if (!c.ok) { tagError = c.error; draw(); return; }
      const tag = canonical(c.tag);
      tagError = '';
      if (!up.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) up.tags.push(tag);
      draw();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    const toggle = (t) => {
      const i = up.tags.findIndex((x) => x.toLowerCase() === t.toLowerCase());
      if (i >= 0) up.tags.splice(i, 1); else up.tags.push(t);
      tagError = '';
      draw();
    };
    return h('section', { class: 'panel stack' },
      h('div', null,
        h('h3', { class: 'panel-title' }, 'Tags for this upload'),
        h('p', { class: 'muted small' }, 'Applied to every athlete in this file. Athletes who already carry tags keep them, and these are added.')),
      h('div', { class: 'row wrap', 'aria-label': 'Tags applied to this upload' },
        up.tags.map((t) => h('span', { class: 'chip chip-on mono' }, t,
          h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remove tag ' + t, onclick: () => toggle(t) }, '×'))),
        input,
        h('button', { type: 'button', class: 'btn-outline mono', onclick: add }, 'ADD TAG')),
      tagError ? h('div', { class: 'mono error-text', role: 'alert' }, tagError) : null,
      h('div', { class: 'row wrap' },
        h('span', { class: 'mono dim label-sm' }, 'EXISTING TAGS'),
        state.library.tags.map((t) => {
          const on = up.tags.some((x) => x.toLowerCase() === t.toLowerCase());
          return h('button', { type: 'button', class: 'chip-btn mono' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: () => toggle(t) }, t);
        })));
  }

  function loaded(up) {
    const p = up.parsed;
    const attention = p.athletes.filter((a) => a.invalid).length;
    return h('div', { class: 'stack-lg' },
      h('section', { class: 'file-card' },
        h('div', null,
          h('div', { class: 'mono accent file-name' }, up.fileName),
          h('div', { class: 'file-line' }, 'File loaded — ' + p.rowCount + ' rows read · ' + plural(p.athletes.length, 'athlete')),
          h('div', { class: 'mono dim small' }, plural(p.dates.length, 'test date') + ' · ' + plural(p.records.length, 'data point')),
          attention ? h('div', { class: 'mono small warn' }, plural(attention, 'profile') + ' with an email-style name will be held back for review.') : null),
        h('button', { type: 'button', class: 'btn-ghost mono', onclick: () => { resetUpload(); draw(); } }, 'CHOOSE A DIFFERENT FILE')),
      h('section', null,
        h('h3', { class: 'label section-label' }, 'Tests detected in this file'),
        h('div', { class: 'grid-2' },
          p.tests.map((t) => h('div', { class: 'panel' },
            h('div', { class: 'label card-title' }, t.label),
            h('div', { class: 'mono dim small card-sub' }, 'Lumin name: ' + t.luminNames.join(', ') + '  →  tab “' + t.tab + '”'),
            h('div', { class: 'mono soft small' }, plural(t.points, 'data point') + ' · ' + t.athletesWithTimes + ' athletes with times · ' + plural(t.dates.length, 'date')))))),
      tagsPanel(up),
      h('div', { class: 'cta-row' },
        up.tags.length === 0 ? h('span', { class: 'mono muted small' }, 'Add at least one tag to continue') : null,
        up.tags.length > 0
          ? h('a', { class: 'btn-primary', href: '#/review' }, 'Review Import →')
          : h('button', { type: 'button', class: 'btn-primary', disabled: true }, 'Review Import →')));
  }

  function draw() {
    clear(root);
    const up = state.upload && !state.upload.result ? state.upload : null;
    root.appendChild(stats());
    const body = h('div', { class: 'content' });
    body.appendChild(h('div', null,
      h('h2', { class: 'screen-title' }, 'New Import'),
      h('p', { class: 'muted' }, 'Drop a Lumin Physical Testing Report export. The tool reads the Test column and files each test in its own tab.')));
    if (blocked) {
      body.appendChild(h('div', { class: 'alert', role: 'alert' },
        h('div', { class: 'label alert-title' }, 'This file cannot be imported'),
        h('ul', null, blocked.map((m) => h('li', null, m)))));
    }
    if (up) body.appendChild(loaded(up));
    else {
      body.appendChild(dropZone());
      if (api.isMock()) {
        body.appendChild(h('div', null,
          h('button', { type: 'button', class: 'btn-outline mono', onclick: async () => { const s = await api.mockSampleFile(); loadText(s.name, s.text); } }, 'LOAD SYNTHETIC SAMPLE EXPORT'),
          h('span', { class: 'mono dim small sample-note' }, ' Mock mode only. Invented names, overlaps the seeded library.')));
      }
    }
    body.appendChild(h('div', { class: 'note' },
      h('div', { class: 'mono accent' }, 'i'),
      h('div', null, 'Nothing is written to the library until you confirm the import on the review screen. Every raw file you upload is also kept in an archive, so any row can be traced back to its source export.')));
    root.appendChild(body);
    root.appendChild(fileInput);
  }
  draw();
}
