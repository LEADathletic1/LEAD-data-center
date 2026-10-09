// Read-side helpers over the client library shape.

// id -> { tab -> [{date, time, source}] sorted oldest first }
export function buildPointIndex(library) {
  const idx = new Map();
  for (const tab of Object.keys(library.points)) {
    for (const row of library.points[tab]) {
      let perTab = idx.get(row[0]);
      if (!perTab) { perTab = {}; idx.set(row[0], perTab); }
      (perTab[tab] || (perTab[tab] = [])).push({ date: row[1], time: Number(row[2]), source: row[3] });
    }
  }
  for (const perTab of idx.values()) for (const tab of Object.keys(perTab)) perTab[tab].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return idx;
}

export function bestOf(points) {
  let best = null;
  for (const p of points || []) if (!best || p.time < best.time) best = p;
  return best;
}

export function latestOf(points) {
  return points && points.length ? points[points.length - 1] : null;
}

export function fmtTime(t) {
  return typeof t === 'number' && isFinite(t) ? t.toFixed(3) : '—';
}

export function countPoints(library) {
  let n = 0;
  for (const tab of Object.keys(library.points)) n += library.points[tab].length;
  return n;
}
