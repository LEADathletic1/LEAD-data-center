import { MAX_TAG_LENGTH } from '../tests.js';

// Trim, enforce length and forbidden characters. Casing is resolved against known tags elsewhere.
export function cleanTag(raw) {
  const tag = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!tag) return { ok: false, error: 'Tag name is empty' };
  if (tag.length > MAX_TAG_LENGTH) return { ok: false, error: 'Tag names can be at most ' + MAX_TAG_LENGTH + ' characters' };
  if (/[,|]/.test(tag)) return { ok: false, error: 'Tag names cannot contain commas or pipes' };
  return { ok: true, tag };
}

// Case-insensitive union that keeps the first casing seen.
export function unionTags(existing, adding) {
  const out = existing.slice();
  const seen = new Set(out.map((t) => t.toLowerCase()));
  for (const t of adding) {
    const k = t.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}
