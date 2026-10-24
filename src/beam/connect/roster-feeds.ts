// CONNECT-019 preparation: saved mapping and review holds; no unattended transport or apply.
import type { Bindings } from '../../auth.server'
import { requireOwner, type Actor } from '../actor'
import { all, commit, insist, newId, now, one, sha256Hex, stmt } from '../core'
import { Input } from '../input'
import { readCsv, readXlsx } from '../movein/tables'
import { previewBatch } from '../roster-batch'
import { COLUMNS, directoryFields } from '../directory'

export async function createRosterFeed(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const name = input.text('name', { max: 100 }), headers = input.list('headers'), mapping = input.list('mapping', { keepEmpty: true })
  insist(headers.length > 0 && headers.length <= 100 && headers.every(value => value.length <= 100) && new Set(headers).size === headers.length, 'invalid_feed_headers')
  insist(headers.length === mapping.length, 'invalid_mapping')
  const targets = new Set([...Object.values(COLUMNS), ...(await directoryFields(env)).map(field => field.id), 'ignore'])
  insist(mapping.every(value => targets.has(value)) && (mapping.includes('employeeId') || mapping.includes('email')), 'invalid_mapping')
  insist(new Set(mapping.filter(value => value !== 'ignore')).size === mapping.filter(value => value !== 'ignore').length, 'mapping_repeated')
  // An explicit human review is required in this slice, regardless of file contents.
  insist(!input.flag('automatic'), 'automatic_feed_not_available', 409)
  const intervalMinutes = input.integer('intervalMinutes', { min: 15, max: 1440 })!, terminationLimit = input.integer('terminationLimit', { min: 1, max: 100 })!
  const id = newId(), at = now()
  await commit(env, [stmt(env, 'INSERT INTO beam_roster_feeds VALUES(?,?,?,?,?,?,?,NULL)', id, name, JSON.stringify(headers), JSON.stringify(mapping), intervalMinutes, terminationLimit, at)],
    { actor, action: 'roster-feed.create', subject: id, detail: { intervalMinutes, terminationLimit, automatic: false } })
  return { id }
}

export async function rosterFeeds(env: Bindings, actor: Actor) {
  requireOwner(actor)
  const feeds = await all(env, 'SELECT * FROM beam_roster_feeds ORDER BY created_at,id')
  return { feeds: feeds.map(row => ({ id: row.id, name: row.name, headers: JSON.parse(row.headers_json), mapping: JSON.parse(row.mapping_json), intervalMinutes: row.interval_minutes, terminationLimit: row.termination_limit,
    lastReceivedAt: row.last_received_at, stale: now() > (row.last_received_at ?? row.created_at) + row.interval_minutes * 60000, automatic: false })),
    receipts: await all(env, 'SELECT r.id,r.feed_id AS feed,r.state,r.reason,r.batch_id AS batch,b.state AS batchState,r.received_at AS receivedAt FROM beam_roster_feed_receipts r LEFT JOIN beam_roster_batches b ON b.id=r.batch_id ORDER BY r.received_at DESC,r.rowid DESC LIMIT 100') }
}

export async function receiveRosterFeed(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const feed = await one(env, 'SELECT * FROM beam_roster_feeds WHERE id=?', input.text('feed'))
  insist(feed, 'feed_not_found', 404)
  const file = (await input.file('file', { maxBytes: 5000000 }))!
  const digest = await sha256Hex(file.bytes), id = newId(), at = now()
  const claimed = await env.DB.prepare("INSERT INTO beam_roster_feed_receipts(id,feed_id,digest,state,received_at) VALUES(?,?,?,'preparing',?) ON CONFLICT(feed_id,digest) DO NOTHING RETURNING id").bind(id, feed.id, digest, at).first()
  if (!claimed) return { ...(await one(env, 'SELECT id,state,reason,batch_id AS batch FROM beam_roster_feed_receipts WHERE feed_id=? AND digest=?', feed.id, digest)), replayed: true }
  let reason = 'review_required', batch: string | null = null
  try {
    const rows = file.bytes[0] === 0x50 && file.bytes[1] === 0x4b ? (await readXlsx(file.bytes))[0]?.rows ?? [] : readCsv(file.bytes).rows
    if (JSON.stringify(rows[0] ?? []) !== feed.headers_json) reason = 'schema_changed'
    else {
      const mapping = JSON.parse(feed.mapping_json) as string[]
      const chunks: string[] = []
      for (let offset = 0; offset < file.bytes.length; offset += 8192) chunks.push(String.fromCharCode(...file.bytes.subarray(offset, offset + 8192)))
      const encoded = btoa(chunks.join(''))
      const preview = await previewBatch(env, actor, Input.of({ file: { filename: file.filename, base64: encoded }, missing: 'keep', invite: false,
        ...Object.fromEntries(mapping.map((value, index) => [`map_${index}`, value])) }))
      batch = preview.id
      const terminations = (preview.counts.deactivate ?? 0) + (preview.counts.deactivate_missing ?? 0)
      const total = preview.rows.length
      reason = total && terminations * 100 > total * feed.termination_limit ? 'mass_terminations' : (preview.counts.error || preview.counts.conflict) ? 'ambiguous_or_invalid_rows' : 'review_required'
    }
    await commit(env, [stmt(env, "UPDATE beam_roster_feed_receipts SET state='held',reason=?,batch_id=? WHERE id=?", reason, batch, id),
      stmt(env, 'UPDATE beam_roster_feeds SET last_received_at=CASE WHEN ? IS NOT NULL THEN ? ELSE last_received_at END WHERE id=?', batch, at, feed.id)], { actor, action: 'roster-feed.receive', subject: id, detail: { feed: feed.id, reason, batch } })
  } catch (error) {
    await env.DB.prepare("UPDATE beam_roster_feed_receipts SET state='failed',reason='preview_failed' WHERE id=?").bind(id).run()
    throw error
  }
  return { id, state: 'held', reason, batch, replayed: false }
}
