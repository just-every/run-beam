import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { nativeHttp } from './native.mjs'

const code = answer => answer.result?._meta?.['com.runeditrun/error']?.code ?? answer.body?.error?.data?.code
function completed(answer) {
  assert.equal(answer.status, 200)
  assert.equal(answer.result?.isError, false)
  assert.ok(answer.result?.structuredContent)
  return answer.result.structuredContent
}

/** Native revisions and local grants stay authoritative alongside Business policy. */
export default async function nativeJourney(context) {
  const { request, origin, tool } = context, http = nativeHttp(context)
  const person = await http.api('me')
  const args = { title: 'Sierra Lakes revised dispatch preparation', reviewer: person.id, idempotency_key: randomUUID() }
  const created = completed(await tool('beam.course.create', args))
  assert.deepEqual(completed(await tool('beam.course.create', args)), created)
  assert.equal(code(await tool('beam.course.create', { ...args, title: 'Changed retained preparation' })), 'idempotency_conflict')
  const before = completed(await tool('beam.course.read', { id: created.id }))
  const edit = { course: created.id, draftVersion: before.draftVersion, title: 'Sierra Lakes dispatch handover', expected_revision: before.draftVersion, idempotency_key: randomUUID() }
  assert.equal(code(await tool('beam.course.save_details', { ...edit, expected_revision: before.draftVersion - 1 })), 'revision_conflict')
  assert.deepEqual(completed(await tool('beam.course.read', { id: created.id })), before)
  const changed = completed(await tool('beam.course.save_details', edit))
  assert.equal(changed.draftVersion, before.draftVersion + 1)
  assert.equal(code(await tool('beam.revision.publish', { revision: created.id })), 'tool_not_found')
  assert.equal(completed(await tool('beam.course.read', { id: created.id })).publishedRevision, null)

  const grant = await http.api('app.issue', { name: 'Sierra Lakes permitted material reader', audience: 'mcp', tools: ['search_material'] })
  let sequence = 0
  const call = async (method, params) => {
    const response = await request(new URL('/mcp', origin).href, { method: 'POST', headers: {
      authorization: `Bearer ${grant.token}`, 'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) })
    return { status: response.status, body: await response.json() }
  }
  const scoped = await call('tools/call', { name: 'beam.material.search', arguments: { query: 'Sierra Lakes' } })
  assert.equal(scoped.status, 200)
  assert.equal(scoped.body.result.isError, false)
  const refused = await call('tools/call', { name: 'beam.report.read', arguments: {} })
  assert.equal(refused.status, 403)
  assert.equal(refused.body.error.data.code, 'insufficient_scope')
  await http.api('app.revoke', { credential: grant.id })
  assert.equal((await call('tools/list', {})).status, 401)
  assert.equal(completed(await tool('beam.course.read', { id: created.id })).draftVersion, changed.draftVersion)
}
