// An original runnable cold-chain quiz. Its producer credential stays on this activity's server.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { sendXapi } from './xapi-fixture.mjs'
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
export async function realActivity(f) {
  const activities = new Set()
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1')
      let body = ''
      if (request.method === 'POST') { for await (const part of request) { body += part; assert.ok(body.length < 16384) } }
      const data = request.method === 'POST' ? new URLSearchParams(body) : url.searchParams
      const registration = data.get('registration'), actor = data.get('actor'), activity = data.get('activity_id')
      let title = 'Vaccine cold chain', content
      if (request.method === 'POST') {
        assert.ok(activities.has(activity))
        const id = activityIds.get(activity)
        assert.ok(id)
        const passed = data.get('temperature') === '5'
        const statement = { id: randomUUID(), actor: JSON.parse(actor), verb: { id: 'http://adlnet.gov/expapi/verbs/completed' }, object: { id: activity, objectType: 'Activity' }, context: { registration }, timestamp: new Date().toISOString(), result: { completion: true, success: passed, score: { scaled: passed ? 1 : 0 } } }
        const accepted = await sendXapi(f, id, statement)
        assert.equal(accepted.status, 200, 'Independent activity result must reach Beam and its real LRS')
        title = passed ? 'Cold-chain check passed' : 'Cold-chain check failed'
        content = `<p>${passed ? 'Your completed and passed statement was accepted by the LRS.' : 'Your failed result was recorded. Course completion was not awarded.'}</p><p><a href="${esc(f.h.origin)}/app/learning">Return to Beam</a></p>`
      } else {
        assert.equal(url.pathname, '/launch')
        content = `<p>Keep vaccines between 2 and 8 degrees. Choose the safe temperature.</p><form method="post" action="/answer">${['registration','actor','activity_id'].map(key => `<input type="hidden" name="${key}" value="${esc(data.get(key))}">`).join('')}<label>Vaccine temperature<select name="temperature"><option value="15">15 degrees</option><option value="5">5 degrees</option></select></label><button>Submit temperature check</button></form>`
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" })
      response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:18px system-ui;max-width:44rem;padding:24px;margin:auto;color:#1d2924;background:#f8faf8}label,select,button{display:block;font:inherit;margin:16px 0;max-width:100%}button{padding:12px}</style><h1>${title}</h1>${content}</html>`)
    } catch { response.writeHead(502); response.end('The activity could not save its result. Return to Beam and inspect the connection.'); }
  })
  const activityIds = new Map()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  return { origin, register(activity, id) { activities.add(activity); activityIds.set(activity, id) }, close: () => new Promise(resolve => server.close(resolve)) }
}
