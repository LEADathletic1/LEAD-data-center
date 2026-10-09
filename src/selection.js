// Pure helpers for Library multi-select. Bulk actions only ever touch rows that are currently visible.

export function visibleSelected(selectedIds, visible) {
  return visible.filter((a) => selectedIds.has(a.id));
}

// Chips for the bulk bar: how many of the selected athletes would gain / lose each tag.
export function bulkChips(selected, allTags) {
  const has = (a, t) => a.tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const add = [];
  const remove = [];
  for (const t of allTags) {
    const gain = selected.filter((a) => !has(a, t)).length;
    const lose = selected.filter((a) => has(a, t)).length;
    if (gain > 0) add.push({ tag: t, count: gain, label: t + '  +' + gain });
    if (lose > 0) remove.push({ tag: t, count: lose, label: t + '  −' + lose });
  }
  return { add, remove };
}

export function allVisibleSelected(selectedIds, visible) {
  return visible.length > 0 && visible.every((a) => selectedIds.has(a.id));
}
