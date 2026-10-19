// The import kit's native target: beam_imported_history rows, one per imported
// course or completion. Every row is independent, so preserved undo observes
// each row and fences the whole set; edited rows are retained, untouched rows go.
import { Buffer } from 'node:buffer'
import type { D1TargetAdapter, TargetRow } from '../../modules/import-kit/src/d1/index'
import { canonicalJson } from '../../modules/import-kit/src/d1/index'

const sql = (text: string, ...params: unknown[]) => ({ sql: text, params })
const toRow = (destination: string, row: any): TargetRow => ({ destination, targetKind: row.kind, targetId: row.id, revision: row.revision, value: JSON.parse(row.payload) })

export const historyTargets: D1TargetAdapter = {
  async read(db, destination, kind, id) {
    const row = await db.prepare('SELECT * FROM beam_imported_history WHERE kind = ? AND id = ?').bind(kind, id).first()
    return row ? toRow(destination, row) : undefined
  },
  matches(row, _destination, kind, id) {
    return row
      ? sql('EXISTS(SELECT 1 FROM beam_imported_history WHERE kind = ? AND id = ? AND revision = ? AND payload = ?)', kind, id, row.revision, canonicalJson(row.value))
      : sql('NOT EXISTS(SELECT 1 FROM beam_imported_history WHERE id = ?)', id)
  },
  // Two exact guards cover the whole native set in one read. Length-prefixed
  // UTF-8 fields protect values as well as revisions, including embedded NULs.
  matchesMany(rows) {
    const field = (value: string) => `${Buffer.byteLength(value)}:${value}`
    const bytes = [...rows].sort((a, b) => Buffer.compare(Buffer.from(a.targetId), Buffer.from(b.targetId)))
      .map(row => [row.targetId, row.targetKind, canonicalJson(row.value), row.revision].map(field).join('')).join('')
    const fields = ['id', 'kind', 'payload', 'revision'].map(column => `length(CAST(${column} AS BLOB))||':'||${column}`).join('||')
    return [
      sql('(SELECT COUNT(*) FROM beam_imported_history)=?', rows.length),
      sql(`(SELECT hex(CAST(coalesce(group_concat(${fields},'' ORDER BY id),'') AS BLOB)) FROM beam_imported_history)=?`, Buffer.from(bytes).toString('hex').toUpperCase()),
    ]
  },
  write(row) {
    return [sql('INSERT INTO beam_imported_history (id, kind, payload, revision) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, payload = excluded.payload, revision = excluded.revision', row.targetId, row.targetKind, canonicalJson(row.value), row.revision)]
  },
  remove(_destination, kind, id) {
    return [sql('DELETE FROM beam_imported_history WHERE kind = ? AND id = ?', kind, id)]
  },
  async list(db, destination) {
    return (await db.prepare('SELECT * FROM beam_imported_history ORDER BY id').all()).results.map(row => toRow(destination, row))
  },
  matchesCount(count) {
    return sql('(SELECT COUNT(*) FROM beam_imported_history) = ?', count)
  },
  async preparePreservedUndo(db, destination, effects) {
    const rows = await this.list(db, destination)
    const byId = new Map(rows.map(row => [row.targetId, row]))
    return {
      observations: effects.map(effect => ({ effectId: effect.provenance.id, current: byId.get(effect.expected.targetId) ?? null, entity: { table: 'beam_imported_history', recordId: effect.expected.targetId } })),
      dependencies: [],
      guards: this.matchesMany!(rows, destination),
    }
  },
}
