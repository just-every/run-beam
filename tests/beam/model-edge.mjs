// Only the paid network edge is substituted; the same public journey can use the held live account.
import assert from 'node:assert/strict'
export function modelEdge(makeResult, { live = false } = {}) {
  const calls = []
  let refusal = false
  return { calls, refuse: () => { refusal = true },
    outboundService: async request => {
      if (request.url !== 'https://api.openai.com/v1/responses') return null
      const body = await request.clone().json()
      calls.push(body)
      assert.equal(body.store, false)
      assert.equal(body.tools, undefined)
      if (!live) return refusal ? Response.json({ error: { code: 'synthetic-beam-1' } }, { status: 403 }) : Response.json({ id: `synthetic-beam-${calls.length}`, status: 'completed', usage: { input_tokens: 1200, output_tokens: 500 }, output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(makeResult(JSON.parse(body.input[0].content[0].text))) }] }] })
      const headers = new Headers(request.headers)
      for (const name of ['content-length', 'host', 'connection', 'transfer-encoding']) headers.delete(name)
      const response = await fetch(request.url, { method: 'POST', headers, body: new Uint8Array(await request.arrayBuffer()), redirect: 'manual', signal: AbortSignal.timeout(90000) })
      console.log('Actual preparation provider HTTP', response.status)
      const returned = new Headers(response.headers); returned.delete('content-encoding'); returned.delete('content-length')
      return new Response(await response.arrayBuffer(), { status: response.status, headers: returned })
    } }
}
