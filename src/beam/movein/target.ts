// The import kit's native target: beam_imported_history rows, one per imported
// course or completion. Every row is independent, so preserved undo observes
// each row and fences the whole set; edited rows are retained, untouched rows go.
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
    return {
      observations: effects.map(effect => ({ effectId: effect.provenance.id, current: rows.find(row => row.targetKind === effect.expected.targetKind && row.targetId === effect.expected.targetId) ?? null, entity: { table: 'beam_imported_history', recordId: effect.expected.targetId } })),
      dependencies: [],
      guards: [this.matchesCount!(rows.length, destination), ...rows.map(row => this.matches(row, destination, row.targetKind, row.targetId))],
    }
  },
}
