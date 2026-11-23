// backup — the export file format and its validation. PURE.
// file: {app:'repkit', schemaVersion, exportedAt, data: {[kvKey]: value}}; images are data URLs in the file
// (the UI converts Blob <-> data URL), everything else is stored as-is.
export const BACKUP_APP = 'repkit';
const REQUIRED = ['meta', 'categories', 'exercises', 'plan'];

export function validateBackup(doc, maxSchema) {
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  if (!isObj(doc) || doc.app !== BACKUP_APP || !isObj(doc.data)) return { ok: false, error: 'not a repkit backup' };
  if ((doc.schemaVersion ?? 0) > maxSchema) return { ok: false, error: 'backup is from a newer repkit — update the app first' };
  if (REQUIRED.some((k) => !(k in doc.data))) return { ok: false, error: 'backup is incomplete' };
  return { ok: true, data: doc.data };
}
