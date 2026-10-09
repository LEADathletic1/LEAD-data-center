import { h, svg, clear, trapDialog, plural } from './dom.js';
import { state } from '../state.js';
import { bestOf, fmtTime } from '../stats.js';

// Right-hand panel with every stored point for one athlete, newest first.
export function openHistory(athleteId, startTab, onClose) {
  const athlete = state.library.athletes.find((a) => a.id === athleteId);
  if (!athlete) return;
  let tab = startTab;
  let release = null;
  const backdrop = h('div', { class: 'drawer-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } });
  const panel = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Test history for ' + athlete.name });
  backdrop.appendChild(panel);

  function close() {
    if (release) release();
    backdrop.remove();
    if (onClose) onClose();
  }

  function trend(points) {
    const W = 560, H = 170, PX = 56, PY = 22;
    const pts = points.slice(); // oldest first
    if (pts.length < 2) return h('p', { class: 'muted small' }, 'A trend line appears once there are two or more tests.');
    const times = pts.map((p) => p.time);
    const lo = Math.min(...times), hi = Math.max(...times);
    const span = hi - lo || 0.001;
    const t0 = new Date(pts[0].date + 'T00:00:00Z').getTime();
    const t1 = new Date(pts[pts.length - 1].date + 'T00:00:00Z').getTime();
    const x = (d) => PX + (t1 === t0 ? 0 : ((new Date(d + 'T00:00:00Z').getTime() - t0) / (t1 - t0)) * (W - PX - 14));
    // Faster (lower) times sit higher on the chart, so an improving athlete's line rises.
    const y = (t) => PY + ((t - lo) / span) * (H - PY * 2);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + x(p.date).toFixed(1) + ' ' + y(p.time).toFixed(1)).join(' ');
    const best = bestOf(pts);
    return svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'trend', role: 'img', 'aria-label': 'Trend: ' + pts.length + ' tests from ' + fmtTime(pts[0].time) + ' to ' + fmtTime(pts[pts.length - 1].time) + ' seconds. Higher on the chart is faster.' },
      svg('line', { x1: PX, y1: PY, x2: W - 14, y2: PY, class: 'grid' }),
      svg('line', { x1: PX, y1: H - PY, x2: W - 14, y2: H - PY, class: 'grid' }),
      svg('text', { x: PX - 8, y: PY + 4, class: 'axis', 'text-anchor': 'end' }, fmtTime(lo)),
      svg('text', { x: PX - 8, y: H - PY + 4, class: 'axis', 'text-anchor': 'end' }, fmtTime(hi)),
      svg('text', { x: W - 14, y: 12, class: 'axis axis-note', 'text-anchor': 'end' }, '↑ faster'),
      svg('path', { d: path, class: 'trend-line', fill: 'none' }),
      pts.map((p) => svg('circle', { cx: x(p.date).toFixed(1), cy: y(p.time).toFixed(1), r: p === best ? 5 : 3, class: p === best ? 'dot best' : 'dot' })));
  }

  function draw() {
    clear(panel);
    const perTab = state.pointIndex.get(athlete.id) || {};
    const asc = perTab[tab] || [];
    const desc = asc.slice().reverse();
    const best = bestOf(asc);
    panel.appendChild(h('div', { class: 'drawer-head' },
      h('div', null,
        h('h2', { class: 'drawer-title' }, athlete.name),
        athlete.aliases.length ? h('div', { class: 'mono dim small' }, 'Also entered as: ' + athlete.aliases.join(', ')) : null,
        h('div', { class: 'row wrap tight-top' }, athlete.tags.map((t) => h('span', { class: 'tag-pill mono' }, t)))),
      h('button', { type: 'button', class: 'btn-ghost mono', onclick: close }, 'CLOSE')));
    panel.appendChild(h('div', { class: 'toggle', role: 'group', 'aria-label': 'Test' },
      state.library.tests.map((t) => h('button', { type: 'button', class: 'toggle-btn label' + (t === tab ? ' on' : ''), 'aria-pressed': t === tab ? 'true' : 'false', onclick: () => { tab = t; draw(); } },
        t + ' (' + (perTab[t] || []).length + ')'))));
    if (!asc.length) { panel.appendChild(h('p', { class: 'muted' }, 'No ' + tab + ' times on file for this athlete.')); return; }
    panel.appendChild(h('div', { class: 'mono soft small' }, plural(asc.length, 'test') + ' · best ' + fmtTime(best.time) + ' on ' + best.date + '  ·  lower is faster'));
    panel.appendChild(trend(asc));
    panel.appendChild(h('table', { class: 'table history' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col', class: 'mono' }, 'DATE'), h('th', { scope: 'col', class: 'mono' }, 'TIME (S)'),
        h('th', { scope: 'col', class: 'mono' }, 'VS PREVIOUS TEST'), h('th', { scope: 'col', class: 'mono' }, 'SOURCE'))),
      h('tbody', null, desc.map((p, i) => {
        const prev = desc[i + 1];
        let change = '—', cls = 'mono dim';
        if (prev) {
          const d = Math.round((p.time - prev.time) * 1000) / 1000;
          if (d < 0) { change = '▼ ' + Math.abs(d).toFixed(3) + ' faster'; cls = 'mono accent'; }
          else if (d > 0) { change = '▲ ' + d.toFixed(3) + ' slower'; cls = 'mono warn'; }
          else { change = 'no change'; }
        }
        return h('tr', null,
          h('td', { class: 'mono' }, p.date),
          h('td', { class: 'mono' + (p === best ? ' accent' : '') }, fmtTime(p.time), p === best ? '  BEST' : ''),
          h('td', { class: cls }, change),
          h('td', { class: 'mono dim' }, p.source || ''));
      }))));
  }
  draw();
  document.body.appendChild(backdrop);
  release = trapDialog(panel, close);
}
