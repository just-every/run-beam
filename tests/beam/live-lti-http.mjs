// A normal HTTPS client to the private Miniflare listener, preserving the hosted
// URL and Host as the public reverse proxy supplied them. No app responses are fabricated.
import { request } from 'node:https'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'

export async function hostedRequest(listener, origin, path, { cookie, body, form, method, headers, bytes } = {}) {
  const verb = method ?? (body !== undefined || form ? 'POST' : 'GET')
  const outgoing = new Headers(headers ?? { origin, ...(cookie ? { cookie } : {}) })
  let data
  if (!['GET', 'HEAD'].includes(verb)) {
    if (bytes) data = Buffer.from(bytes)
    else if (body !== undefined) { data = Buffer.from(JSON.stringify(body)); outgoing.set('content-type', 'application/json') }
    else if (form) {
      const encoded = new Response(form)
      data = Buffer.from(await encoded.arrayBuffer()); outgoing.set('content-type', encoded.headers.get('content-type'))
    }
  }
  outgoing.set('host', new URL(origin).host)
  outgoing.set('MF-Original-URL', origin + path)
  outgoing.set('accept-encoding', 'identity')
  outgoing.delete('content-length'); outgoing.delete('transfer-encoding')
  return new Promise((resolve, reject) => {
    // Only the private fixture uses a self-signed certificate. Public tool/relay fetches validate TLS normally.
    const req = request(new URL(path, listener), { method: verb, headers: Object.fromEntries(outgoing), rejectUnauthorized: false }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk)); res.on('error', reject)
      res.on('end', () => {
        try {
          const received = new Headers()
          for (let i = 0; i < res.rawHeaders.length; i += 2) received.append(res.rawHeaders[i], res.rawHeaders[i + 1])
          let payload = Buffer.concat(chunks)
          const encoding = received.get('content-encoding')
          if (encoding === 'br') payload = brotliDecompressSync(payload)
          else if (encoding === 'gzip') payload = gunzipSync(payload)
          else if (encoding === 'deflate') payload = inflateSync(payload)
          if (encoding) { received.delete('content-encoding'); received.delete('content-length') }
          resolve(new Response(verb === 'HEAD' || [204, 205, 304].includes(res.statusCode) ? null : payload, { status: res.statusCode, headers: received }))
        } catch (error) { reject(error) }
      })
    })
    req.setTimeout(20_000, () => req.destroy(new Error('Hosted fixture transport timed out')))
    req.on('error', reject); req.end(data)
  })
}
