// Small RFC 4180 CSV reader/writer. No dependencies.

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const endRow = () => {
    row.push(field);
    field = '';
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else if (c === '\n') {
      endRow();
    } else field += c;
  }
  if (inQuotes) throw new Error('The file has an unterminated quoted field. It may be damaged or cut off.');
  if (field !== '' || row.length) endRow();
  return rows;
}

// A leading = + - @ makes spreadsheet apps run the cell as a formula.
export function csvSafe(value) {
  const s = String(value ?? '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

export function toCSV(rows) {
  const esc = (v) => {
    const s = csvSafe(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}
