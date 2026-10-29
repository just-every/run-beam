import { fixture } from './regression-fixture.mjs'
import { sourceProcedureDocx } from './source-fixtures.mjs'
export const microsoftBindings = { ENTRA_TENANT_ID: '11111111-1111-1111-1111-111111111111', ENTRA_CLIENT_ID: '22222222-2222-2222-2222-222222222222', ENTRA_CLIENT_SECRET: 'synthetic-beam-1', ENTRA_SCIM_TOKEN: 'synthetic-beam-3' }
export const microsoftSite = 'synthetic-beam.sharepoint.com,33333333-3333-3333-3333-333333333333,44444444-4444-4444-4444-444444444444'
export async function microsoftFixture() {
  const state = { version: 1, denied: false, wrongBoundary: false, permissions: [{ id: 'synthetic-beam-1', roles: ['read'] }], redirect: null, requests: [], document: sourceProcedureDocx }
  const f = await fixture({ bindings: microsoftBindings, clock: Date.UTC(2026, 9, 20, 12), businessName: 'Sierra Lakes Produce', names: { author: 'Jordan Lee', reviewer: 'Sam Taylor', learner: 'Riley Morgan', manager: 'Nina Brooks', assessor: 'Avery Carter' }, outboundService: async request => {
    const url = new URL(request.url)
    if (url.hostname === 'login.microsoftonline.com') {
      const fields = await request.formData()
      if (fields.get('client_secret') !== microsoftBindings.ENTRA_CLIENT_SECRET || fields.get('grant_type') !== 'client_credentials' || fields.get('scope') !== 'https://graph.microsoft.com/.default') return Response.json({ error: 'synthetic-beam-1' }, { status: 401 })
      state.requests.push({ operation: 'token' })
      return Response.json({ access_token: 'synthetic-beam-2', token_type: 'Bearer', expires_in: 3600 })
    }
    if (url.hostname === 'synthetic-beam.sharepoint.com') {
      state.requests.push({ operation: 'download', authorization: request.headers.has('authorization') })
      return new Response(state.document)
    }
    if (url.hostname !== 'graph.microsoft.com') return null
    if (request.headers.get('authorization') !== 'Bearer synthetic-beam-2') return Response.json({}, { status: 401 })
    state.requests.push({ operation: 'graph', path: url.pathname })
    const path = decodeURIComponent(url.pathname.slice('/v1.0'.length))
    if (path === '/users') return Response.json({ value: [{ id: 'synthetic-beam-3', assignedLicenses: [] }] })
    if (path === '/sites') return Response.json({ value: [{ id: microsoftSite, displayName: 'Sierra Lakes operations' }] })
    if (path === `/sites/${microsoftSite}`) return Response.json({ id: microsoftSite, webUrl: 'https://synthetic-beam.sharepoint.com/sites/operations' })
    if (path === `/sites/${microsoftSite}/drives`) return Response.json({ value: [{ id: 'synthetic-beam-library', name: 'Procedures' }] })
    if (path === '/drives/synthetic-beam-library/root/children') return Response.json({ value: [{ id: 'synthetic-beam-procedure', name: 'Opening procedure.docx', file: {}, size: state.document.length }] })
    if (path.startsWith('/drives/synthetic-beam-library/items/synthetic-beam-procedure')) {
      if (state.denied) return Response.json({ error: { code: 'accessDenied', message: 'synthetic-beam-9 private detail' } }, { status: 403 })
      if (path.endsWith('/permissions')) return Response.json({ value: state.permissions })
      if (path.endsWith('/content')) return state.redirect ? new Response(null, { status: 302, headers: { location: state.redirect } }) : new Response(state.document)
      return Response.json({ id: 'synthetic-beam-procedure', name: 'Opening procedure.docx', size: state.document.length, file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, eTag: `synthetic-beam-${state.version}`, parentReference: { siteId: microsoftSite, driveId: state.wrongBoundary ? 'synthetic-beam-other-library' : 'synthetic-beam-library' } })
    }
    throw new Error('Unexpected Graph operation')
  } })
  const connect = () => f.api('owner', 'microsoft.configure', { operation: 'connect', site: microsoftSite, drive: 'synthetic-beam-library', reason: 'Employer-owned operations procedures authorized for reviewed training', consent: true })
  const preview = () => f.api('owner', 'microsoft.preview', { item: 'synthetic-beam-procedure' })
  const imported = async () => { const p = await preview(); return f.api('owner', 'microsoft.import', { ...p, reviewed: true, title: 'Opening procedure', licence: 'owned', licenceEvidence: 'Employer authored work procedure', reviewer: f.ids.reviewer }) }
  return { ...f, state, connect, preview, imported }
}
