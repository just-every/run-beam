// Fakes only the remote LRS network edge for push CI; --live forwards to the independent SQL LRS.
import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'
export const lrsEndpoint = 'https://synthetic-beam-1.example.test/xapi/'
export const activityIri = 'https://synthetic-beam-1.example.test/cold-chain'
export const producerSecret = 'synthetic-beam-3'
export function multipart(statement, bytes) {
  const boundary = 'synthetic-beam-4', metadata = statement.attachments[0]
  return { contentType: `multipart/mixed; boundary=${boundary}`, body: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(statement)}\r\n--${boundary}\r\nContent-Type: ${metadata.contentType}\r\nContent-Transfer-Encoding: binary\r\nX-Experience-API-Hash: ${metadata.sha2}\r\n\r\n`), Buffer.from(bytes), Buffer.from(`\r\n--${boundary}--\r\n`)]) }
}
function parseBody(bytes, contentType) {
  if (!contentType.startsWith('multipart/mixed')) return { statements: [JSON.parse(bytes.toString())].flat(), attachments: [] }
  const boundary = contentType.match(/boundary="?([^";]+)/)[1], parts = bytes.toString('latin1').split(`--${boundary}`).slice(1, -1)
  const first = parts.shift().split('\r\n\r\n').slice(1).join('\r\n\r\n').slice(0, -2)
  return { statements: [JSON.parse(Buffer.from(first, 'latin1').toString())].flat(), attachments: parts.map(part => { const split = part.indexOf('\r\n\r\n'); return { sha256: part.slice(0, split).match(/X-Experience-API-Hash: ([^\r]+)/i)[1], contentType: part.slice(0, split).match(/Content-Type: ([^\r]+)/i)[1], bytes: Buffer.from(part.slice(split + 4, -2), 'latin1') } }) }
}
export async function xapiFixture({ liveEndpoint, outboundService } = {}) {
  const records = new Map(), edge = { writes: 0, refuse: false, tamper: false }
  const f = await fixture({ ownerName: 'Avery Patel', businessName: 'Sierra Lakes Produce', names: { author: 'Jordan Brooks', reviewer: 'Morgan Lee', learner: 'Elena Gomez', assessor: 'Priya Shah', other: 'Chris Adams', manager: 'Tom Okafor' }, bindings: { BEAM_XAPI_HOSTS: 'synthetic-beam-1.example.test', ...(liveEndpoint ? { BEAM_XAPI_LOCAL_SANDBOX: 'true' } : {}) }, outboundService: async request => {
    if (outboundService) { const response = await outboundService(request.clone()); if (response) return response }
    const url = new URL(request.url), endpoint = liveEndpoint || lrsEndpoint
    if (!request.url.startsWith(endpoint)) return null
    assert.ok(request.headers.get('authorization') === `Basic ${Buffer.from('synthetic-beam-1:synthetic-beam-2').toString('base64')}`, 'LRS authorization differs')
    assert.ok(request.headers.get('x-experience-api-version') === '1.0.3', 'LRS version header differs')
    if (liveEndpoint) {
      const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.method === 'POST' ? Buffer.from(await request.arrayBuffer()) : undefined, redirect: 'manual' })
      return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers })
    }
    const headers = { 'x-experience-api-version': '1.0.3' }
    if (url.pathname.endsWith('/about')) return Response.json({ version: ['1.0.3'] }, { headers: { ...headers, 'x-experience-api-version': '2.0.0' } })
    if (request.method === 'POST') {
      edge.writes++
      if (edge.refuse) return Response.json({ error: 'synthetic-beam-5' }, { status: 503, headers })
      const batch = parseBody(Buffer.from(await request.arrayBuffer()), request.headers.get('content-type'))
      for (const statement of batch.statements) records.set(statement.id, { statement: { ...statement, stored: new Date().toISOString(), authority: { objectType: 'Agent', account: { homePage: 'https://lrs.example.test', name: 'synthetic-beam-1' } } }, attachments: batch.attachments })
      return Response.json(batch.statements.map(s => s.id), { headers })
    }
    const record = records.get(url.searchParams.get('statementId'))
    assert.ok(record)
    const statement = edge.tamper ? { ...record.statement, actor: { account: { homePage: 'https://foreign.example.test', name: 'foreign' } } } : record.statement
    if (!record.attachments.length) return Response.json(statement, { headers })
    const body = multipart(statement, record.attachments[0].bytes)
    return new Response(body.body, { headers: { ...headers, 'content-type': body.contentType } })
  } })
  return { ...f, lrs: { records, edge, endpoint: liveEndpoint || lrsEndpoint } }
}
export async function sendXapi(f, activity, statement, { bytes, password = producerSecret, method = 'POST' } = {}) {
  const encoded = bytes ? multipart(statement, bytes) : { contentType: 'application/json', body: JSON.stringify(statement) }
  return f.h.fetch(`/api/beam/xapi/statements${method === 'PUT' ? `?statementId=${statement.id}` : ''}`, { method, headers: { authorization: `Basic ${Buffer.from(`${activity}:${password}`).toString('base64')}`, 'content-type': encoded.contentType, 'x-experience-api-version': '1.0.3' }, body: encoded.body })
}
