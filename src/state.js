import { buildPointIndex } from './stats.js';

export const state = {
  user: null,
  mock: false,
  library: null,
  pointIndex: null,
  upload: null, // the file being imported: { fileName, csv, parsed, tags, included, decisions, result }
  version: 0, // bumped by every library write so a stale background refresh can be dropped
};

export function setLibrary(lib) {
  state.library = lib;
  state.pointIndex = buildPointIndex(lib);
}

export function resetUpload() { state.upload = null; }
