// Source-independent constants shared by the importer, the mock backend and Apps Script.

const TEST_TABS = ['10 Yard', '30 Yard'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_TOLERANCE = 0.0005;
const STARTER_TAGS = ['Performance', '1More'];
const MAX_TAG_LENGTH = 30;

function isValidIsoDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export { TEST_TABS, DATE_RE, TIME_TOLERANCE, STARTER_TAGS, MAX_TAG_LENGTH, isValidIsoDate };
