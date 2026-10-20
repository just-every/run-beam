// Network-edge fixture for the clone journey's real `rer deploy --dry-run`.
// This synthetic Cloudflare account has a workers.dev subdomain and no target
// Worker or secrets. Only those metadata GETs are allowed; every write fails.
// Load only in that command via NODE_OPTIONS, never in the application or browser.
const fetch = globalThis.fetch
const account = '/client/v4/accounts/11111111111111111111111111111111'
const worker = `${account}/workers/scripts/beam-production`

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input)
  if (url.hostname !== 'api.cloudflare.com') return fetch(input, init)
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method !== 'GET' || url.origin !== 'https://api.cloudflare.com' || url.search || url.hash || url.username || url.password) {
    throw new Error('Unexpected Cloudflare API request in the deploy dry-run fixture')
  }
  if (url.pathname === `${account}/workers/subdomain`) return Response.json({ success: true, result: { subdomain: 'beam-journey' } })
  if (url.pathname === `${worker}/settings`) return Response.json({ success: false, errors: [{ code: 10007, message: 'Worker not found' }] }, { status: 404 })
  if (url.pathname === `${worker}/secrets`) return Response.json({ success: true, result: [] })
  throw new Error('Unexpected Cloudflare API request in the deploy dry-run fixture')
}
