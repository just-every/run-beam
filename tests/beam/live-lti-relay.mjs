// Transparent public transport: the hosted endpoint returns only responses from the actual built Beam Worker.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { required, pause } from './live-provider-runtime.mjs'
const source = `
export default {fetch(r,e){return e.RELAY.get(e.RELAY.idFromName('proof')).fetch(r)}};
export class Relay {
 constructor(state,env){this.env=env;this.queue=[];this.waiting=new Map()}
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(path.startsWith('/_relay/')){
   if(request.headers.get('authorization')!=='Bearer '+this.env.CONTROL)return new Response(null,{status:401});
   if(path==='/_relay/next')return Response.json({requests:this.queue.splice(0,20)});
   if(path==='/_relay/answer'){
    const answer=await request.json(),resolve=this.waiting.get(answer.id);
    if(!resolve)return new Response(null,{status:404});
    this.waiting.delete(answer.id);resolve(answer);return Response.json({ok:true});
   }
   return new Response(null,{status:404});
  }
  if(!/^\\/api\\/beam\\/lti\\/(jwks|token|deep-link|lineitems\\/[a-zA-Z0-9_-]+\\/scores)$/.test(path))return new Response(null,{status:404});
  if(this.waiting.size>=20)return new Response(null,{status:429});
  const id=crypto.randomUUID(),body=Array.from(new Uint8Array(await request.arrayBuffer()));
  let resolve;const pending=new Promise(r=>resolve=r);this.waiting.set(id,resolve);
  this.queue.push({id,path:path+new URL(request.url).search,method:request.method,headers:[...request.headers],body});
  const timer=setTimeout(()=>{this.waiting.delete(id);resolve(null)},25000);
  const answer=await pending;clearTimeout(timer);
  if(!answer)return new Response(null,{status:504});
  return new Response([204,205,304].includes(answer.status)?null:new Uint8Array(answer.body),{status:answer.status,headers:answer.headers});
 }
}`
export async function publicRelay() {
  assert.equal(required('CLOUDFLARE_ACCOUNT_ID'), 'b20c0ca9cab0c2b70e13d7cf724b89bd')
  const base = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`
  async function cf(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${required('CLOUDFLARE_API_TOKEN')}`, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
    if (response.status === 404) return null
    const data = await response.json()
    assert.ok(response.ok && data.success, `Cloudflare relay ${method} HTTP ${response.status}; codes ${(data.errors ?? []).map(e => e.code).join(',')}`)
    return data.result
  }
  const subdomain = (await cf('/workers/subdomain')).subdomain
  assert.equal(subdomain, 'runeditrun')
  const name = `beam-lti-${randomBytes(6).toString('hex')}`, control = randomBytes(32).toString('base64url')
  assert.equal(await cf(`/workers/scripts/${name}`), null, 'Never replace another Worker')
  const origin = `https://${name}.${subdomain}.workers.dev`
  let created = false, stopped = false, task
  async function admin(path, body) {
    const response = await fetch(origin + '/_relay/' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${control}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) })
    assert.equal(response.status, 200, 'Relay authenticated transport door')
    return response.json()
  }
  return {
    origin, name,
    async deploy() {
      const form = new FormData()
      form.set('metadata', new Blob([JSON.stringify({ main_module: 'relay.mjs', compatibility_date: '2026-09-08', bindings: [{ type: 'secret_text', name: 'CONTROL', text: control }, { type: 'durable_object_namespace', name: 'RELAY', class_name: 'Relay' }], migrations: { new_tag: 'v1', steps: [{ new_sqlite_classes: ['Relay'] }] } })], { type: 'application/json' }))
      form.set('relay.mjs', new Blob([source], { type: 'application/javascript+module' }), 'relay.mjs')
      created = true
      await cf(`/workers/scripts/${name}`, 'PUT', form)
      await cf(`/workers/scripts/${name}/subdomain`, 'POST', { enabled: true, previews_enabled: false })
      let ready = false
      for (let n = 0; n < 12; n++) { try { await admin('next'); ready = true; break } catch { await pause(3000) } }
      assert.ok(ready, 'Public relay provisioned')
    },
    start(beamRequest) {
      task = (async () => {
        while (!stopped) {
          const batch = await admin('next')
          await Promise.all(batch.requests.map(async request => {
            // Use exact public request URL, headers and bytes. No protocol result is fabricated.
            const response = await beamRequest(request.path, { method: request.method, headers: request.headers, bytes: request.body })
            await admin('answer', { id: request.id, status: response.status, headers: [...response.headers], body: [...new Uint8Array(await response.arrayBuffer())] })
          }))
          await pause(200)
        }
      })()
      // Preserve failures for close(), without an unhandled rejection while the driver is awaiting Saltire.
      task.catch(() => {})
    },
    async close() {
      stopped = true
      try { if (task) await task } finally {
        if (created) { await cf(`/workers/scripts/${name}?force=true`, 'DELETE'); assert.equal(await cf(`/workers/scripts/${name}`), null, 'Public relay deleted') }
      }
    },
  }
}
