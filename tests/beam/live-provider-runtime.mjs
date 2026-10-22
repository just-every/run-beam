// Opt-in provider qualification. Invoke only via briefs/_od08-env.py; never log credentials.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fixture } from './regression-fixture.mjs'

export function required(name) {
  assert.ok(process.env[name]?.trim(), `Missing ${name}; inject through _od08-env.py`)
  return process.env[name]
}
export function optIn() { assert.equal(process.env.BEAM_LIVE_PROOF, '1', 'Set BEAM_LIVE_PROOF=1 explicitly') }
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function evidence(name, result) {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  console.log(JSON.stringify({ check: name, sha, completedAt: new Date().toISOString(), ...result }))
}


/** Preserve application bytes and headers while letting the real client own HTTP hop framing. */
async function forward(request, names) {
  const headers = Object.fromEntries(names.flatMap(name => request.headers.has(name) ? [[name, request.headers.get(name)]] : []))
  try {
    const response = await fetch(request.url, { method: request.method, headers, body: await request.arrayBuffer(), redirect: 'manual', signal: AbortSignal.timeout(12_000) })
    console.log(`LIVE_PROVIDER host=${new URL(request.url).hostname} status=${response.status}`)
    return response
  } catch (error) {
    const code = /^[A-Z0-9_]+$/.test(error.cause?.code ?? '') ? error.cause.code : 'UNAVAILABLE'
    console.log(`LIVE_PROVIDER transport=${error.name} code=${code}`)
    throw new Error('Live provider transport failed')
  }
}

/** Only fixture mail to reserved .test recipients is faked. Target delivery uses real SendGrid. */
export async function liveFixture({ mail = false, bindings = {}, receiverOrigin } = {}) {
  const target = mail ? required('TEST_MAIL_TO').toLowerCase() : null
  if (mail) assert.match(target, /^qa-inbox(?:-\d+)?@runeditrun\.com$/, 'Use a documented literal QA-inbox route')
  const outboundService = async (request, { mails }) => {
    if (request.url === 'https://api.sendgrid.com/v3/mail/send') {
      const payload = await request.clone().json()
      const recipients = payload.personalizations.flatMap(p => ['to', 'cc', 'bcc'].flatMap(k => (p[k] || []).map(x => x.email.toLowerCase())))
      assert.ok(recipients.length)
      if (recipients.every(address => address.endsWith('@example.test'))) {
        mails.push({ to: recipients, subject: payload.subject, text: payload.content.find(x => x.type === 'text/plain')?.value, html: payload.content.find(x => x.type === 'text/html')?.value })
        return new Response(null, { status: 202, headers: { 'x-message-id': `synthetic-beam-${mails.length}` } })
      }
      assert.ok(mail && recipients.length === 1 && recipients[0] === target, 'Unexpected live mail recipient')
      return forward(request, ['authorization', 'content-type'])
    }
    if (receiverOrigin && new URL(request.url).origin === receiverOrigin) {
      assert.equal(new URL(request.url).pathname, '/hooks')
      return forward(request, ['content-type', 'x-beam-event-id', 'x-beam-key-version', 'x-beam-signature'])
    }
    return null
  }
  return fixture({ bindings: { ...(mail ? { MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: required('MAIL_API_KEY'), MAIL_FROM: required('MAIL_FROM') } : {}), ...bindings }, outboundService })
}

export async function receiptFor({ since, title, subject, assignment, bodyPhrase, timeout = 120_000 }) {
  const url = new URL('https://rer-qa-inbox.runeditrun.workers.dev/receipts')
  url.search = new URLSearchParams({ since: String(since), to: required('TEST_MAIL_TO'), contains: title, limit: '50' })
  const headers = { Authorization: `Bearer ${required('QA_INBOX_RECEIPT_TOKEN')}` }
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
    assert.equal(response.status, 200, 'QA-inbox receipt query')
    const data = await response.json()
    const receipt = data.receipts.find(row => row.subject === subject && row.excerpt?.includes(title) && row.excerpt.includes(assignment))
    if (receipt) {
      assert.ok(receipt.excerpt.includes(bodyPhrase), 'Delivered body uses the chosen language')
      assert.ok(receipt.rawUrl, 'Full delivered MIME is required')
      const raw = await fetch(new URL(receipt.rawUrl, url), { headers, signal: AbortSignal.timeout(20_000) })
      assert.equal(raw.status, 200, 'Delivered raw MIME exists')
      assert.ok((await raw.arrayBuffer()).byteLength > 0)
      assert.equal(receipt.auth?.dmarc, 'pass', 'Receiver authenticates delivered reminder')
      return { id: receipt.id, receivedAt: receipt.receivedAt, subject: receipt.subject, assignment, authenticated: true, bodyLanguageVerified: true, rawMimeVerified: true }
    }
    await pause(3000)
  }
  throw new Error('Delivered reminder receipt missing before deadline; provider acceptance is insufficient')
}

// A real HTTPS receiver backed by Durable Object storage. No Beam responses are simulated.
const receiverSource = `
export default {fetch(request,env){return env.RECEIPTS.get(env.RECEIPTS.idFromName('proof')).fetch(request)}};
export class Receipts {
 constructor(state,env){this.state=state;this.env=env}
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(path!=='/hooks'){
   if(request.headers.get('authorization')!=='Bearer '+this.env.CONTROL_TOKEN)return new Response(null,{status:401});
   if(path==='/control'&&request.method==='POST'){
    const control=await request.json();
    if(typeof control.reject==='boolean')await this.state.storage.put('reject',control.reject);
    if(typeof control.signingKey==='string')await this.state.storage.put('signingKey',control.signingKey);
    return Response.json({ok:true});
   }
   if(path==='/receipts'&&request.method==='GET')return Response.json({receipts:await this.state.storage.get('receipts')||[]});
   return new Response(null,{status:404});
  }
  if(request.method!=='POST')return new Response(null,{status:405});
  const body=await request.text(),m=/^t=(\\d+),v1=([a-f0-9]{64})$/.exec(request.headers.get('x-beam-signature')||'');
  let valid=false;
  if(m&&Math.abs(Date.now()/1000-Number(m[1]))<300){
   const signingKey=await this.state.storage.get('signingKey')||this.env.SIGNING_KEY;
   const key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(signingKey),c=>c.charCodeAt(0)),{name:'HMAC',hash:'SHA-256'},false,['verify']);
   valid=await crypto.subtle.verify('HMAC',key,Uint8Array.from(m[2].match(/../g),x=>parseInt(x,16)),new TextEncoder().encode(m[1]+'.'+body));
  }
  let envelope;try{envelope=JSON.parse(body)}catch{return new Response(null,{status:400})}
  valid=valid&&envelope.id===request.headers.get('x-beam-event-id');
  const receipts=await this.state.storage.get('receipts')||[],reject=await this.state.storage.get('reject')===true;
  const accepted=valid&&!reject,duplicate=accepted&&receipts.some(r=>r.accepted&&r.id===envelope.id);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))),x=>x.toString(16).padStart(2,'0')).join('');
  receipts.push({id:envelope.id,type:envelope.type,valid,accepted,duplicate,digest,keyVersion:request.headers.get('x-beam-key-version'),receivedAt:Date.now()});
  await this.state.storage.put('receipts',receipts);
  return new Response(null,{status:accepted?204:401});
 }
}`

export async function receiverAccount() {
  assert.equal(required('CLOUDFLARE_ACCOUNT_ID'), 'b20c0ca9cab0c2b70e13d7cf724b89bd', 'RunEditRun account only')
  const base = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`
  const cf = async (path, { method = 'GET', body, missing = false } = {}) => {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${required('CLOUDFLARE_API_TOKEN')}`, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
    if (missing && response.status === 404) return null
    let data; try { data = await response.json() } catch {}
    assert.ok(response.ok && data?.success, `Cloudflare ${method} ${path}: HTTP ${response.status}; codes ${(data?.errors || []).map(x => x.code).join(',')}`)
    return data.result
  }
  const { subdomain } = await cf('/workers/subdomain')
  assert.equal(subdomain, 'runeditrun')
  const name = `beam-live-${randomBytes(6).toString('hex')}`
  assert.equal(await cf(`/workers/scripts/${name}`, { missing: true }), null, 'Never overwrite an existing Worker')
  const origin = `https://${name}.${subdomain}.workers.dev`, control = randomBytes(32).toString('base64url')
  let created = false
  return {
    origin, name,
    async deploy(key) {
      const form = new FormData()
      form.set('metadata', new Blob([JSON.stringify({ main_module: 'receiver.mjs', compatibility_date: '2026-09-08', bindings: [{ type: 'secret_text', name: 'CONTROL_TOKEN', text: control }, { type: 'secret_text', name: 'SIGNING_KEY', text: key }, { type: 'durable_object_namespace', name: 'RECEIPTS', class_name: 'Receipts' }], migrations: { new_tag: 'v1', steps: [{ new_sqlite_classes: ['Receipts'] }] } })], { type: 'application/json' }))
      form.set('receiver.mjs', new Blob([receiverSource], { type: 'application/javascript+module' }), 'receiver.mjs')
      // Mark before the write: even an uncertain API result requires cleanup.
      created = true
      await cf(`/workers/scripts/${name}`, { method: 'PUT', body: form })
      await cf(`/workers/scripts/${name}/subdomain`, { method: 'POST', body: { enabled: true, previews_enabled: false } })
    },
    // Receiver administration is serialized by its Durable Object, before another Beam send.
    async rotate(key) { await this.request('/control', { signingKey: key }) },
    async request(path, body) {
      const r = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${control}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) })
      assert.equal(r.status, 200, 'Receiver control door')
      return r.json()
    },
    async close() {
      if (created) {
        await cf(`/workers/scripts/${name}?force=true`, { method: 'DELETE', missing: true })
        assert.equal(await cf(`/workers/scripts/${name}`, { missing: true }), null, 'Disposable receiver removed')
      }
    },
  }
}
