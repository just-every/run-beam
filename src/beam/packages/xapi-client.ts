// xAPI 1.0.3 network boundary. Callers authorize and allowlist the LRS endpoint.
import { BeamError, insist } from '../core'
import { canonicalJSON, normalizeUuid, parseXapiJson, parseXapiRequest, readBoundedBytes, validateAttachmentParts, XAPI_JSON_LIMIT, type XapiAttachment, type XapiBatch, type XapiStatement } from './xapi-protocol'

const encoder = new TextEncoder()
const VERSION = '1.0.3'

function resource(endpoint: string, name: string): URL {
  let url: URL
  try { url = new URL(endpoint) } catch { throw new BeamError('xapi_invalid_endpoint') }
  insist(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, 'xapi_invalid_endpoint')
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${name}`
  return url
}

async function exchange<T>(url: URL, authorization: string, init: RequestInit, consume: (response: Response) => Promise<T>, discovery = false): Promise<T> {
  insist(typeof authorization === 'string' && authorization.length > 0 && authorization.length <= 8192 && !/[\r\n\u0000]/.test(authorization), 'xapi_invalid_authorization')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  let response: Response | undefined
  try {
    response = await fetch(url.toString(), {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
      headers: { ...init.headers, Authorization: authorization, 'X-Experience-API-Version': VERSION, Accept: 'application/json, multipart/mixed' },
    })
    // Never reflect response text, endpoint, credentials or raw fetch exceptions.
    insist(response.status === 200, 'xapi_lrs_http_error', 502, { status: response.status })
    const version = response.headers.get('x-experience-api-version') ?? ''
    // ADL 1.0.3 §§2.8/3.3: About discovers versions; its header need not echo the request.
    insist(discovery ? /^\d+\.\d+\.\d+$/.test(version) && Number(version.split('.')[0]) >= 1 : version === VERSION, 'xapi_lrs_version_mismatch', 502)
    return await consume(response)
  } catch (error) {
    if (controller.signal.aborted) throw new BeamError('xapi_lrs_timeout', 504)
    if (error instanceof BeamError) {
      if (error.status < 500) throw new BeamError('xapi_lrs_invalid_response', 502)
      throw error
    }
    throw new BeamError('xapi_lrs_network_error', 502)
  } finally {
    clearTimeout(timer)
    if (response?.body && !response.bodyUsed) void response.body.cancel().catch(() => {})
  }
}

async function json(response: Response, limit = XAPI_JSON_LIMIT): Promise<any> {
  insist(response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() === 'application/json', 'xapi_lrs_content_type', 502)
  return parseXapiJson(await readBoundedBytes(response, limit))
}

/** POST original validated statements and raw attachment octets, with no retries. */
export async function sendStatements(endpoint: string, authorization: string, statements: XapiStatement[], attachments: XapiAttachment[] = []): Promise<{ ids: string[] }> {
  insist(Array.isArray(statements) && statements.length > 0 && statements.length <= 20, 'xapi_invalid_statement_batch')
  const ids = statements.map(statement => normalizeUuid(statement.id))
  insist(new Set(ids).size === ids.length, 'xapi_duplicate_statement')
  // canonicalJSON checks values/depth; transmit original property values/ordering.
  canonicalJSON(statements)
  const source = JSON.stringify(statements)
  insist(encoder.encode(source).length <= XAPI_JSON_LIMIT, 'xapi_json_too_large', 413)
  await validateAttachmentParts(statements, attachments)
  let body: BodyInit = source, contentType = 'application/json'
  if (attachments.length) {
    const boundary = `beam-${crypto.randomUUID()}`
    const pieces: BlobPart[] = [`--${boundary}\r\nContent-Type: application/json\r\n\r\n${source}\r\n`]
    for (const part of attachments) {
      pieces.push(`--${boundary}\r\nContent-Type: ${part.contentType}\r\nContent-Transfer-Encoding: binary\r\nX-Experience-API-Hash: ${part.sha256.toLowerCase()}\r\n\r\n`)
      // Copy into an ArrayBuffer-backed view, including on SharedArrayBuffer hosts.
      pieces.push(new Uint8Array(part.bytes))
      pieces.push('\r\n')
    }
    pieces.push(`--${boundary}--\r\n`)
    body = new Blob(pieces)
    contentType = `multipart/mixed; boundary="${boundary}"`
  }
  return exchange(resource(endpoint, 'statements'), authorization, { method: 'POST', headers: { 'Content-Type': contentType }, body }, async response => {
    const returned = await json(response, 16 * 1024)
    insist(Array.isArray(returned) && returned.length === ids.length, 'xapi_lrs_invalid_receipt', 502)
    const accepted = returned.map(normalizeUuid)
    insist(accepted.every((id, index) => id === ids[index]), 'xapi_lrs_receipt_mismatch', 502)
    return { ids: accepted }
  })
}

/** Readback retains LRS-added authority/stored metadata; inbound profile validation is separate. */
export async function getStatement(endpoint: string, authorization: string, id: string, attachments = true): Promise<{ statement: XapiStatement; attachments: XapiAttachment[] }> {
  const uuid = normalizeUuid(id), url = resource(endpoint, 'statements')
  url.searchParams.set('statementId', uuid)
  url.searchParams.set('attachments', String(attachments))
  url.searchParams.set('format', 'exact')
  return exchange(url, authorization, { method: 'GET' }, async response => {
    let batch: XapiBatch
    if (attachments) batch = await parseXapiRequest(response)
    else {
      const statement = await json(response)
      insist(statement && typeof statement === 'object' && !Array.isArray(statement), 'xapi_lrs_invalid_statement', 502)
      batch = { statements: [statement], attachments: [] }
    }
    insist(batch.statements.length === 1 && normalizeUuid(batch.statements[0].id) === uuid, 'xapi_lrs_statement_mismatch', 502)
    return { statement: batch.statements[0], attachments: batch.attachments }
  })
}

export async function probeLrs(endpoint: string, authorization: string): Promise<{ versions: string[] }> {
  return exchange(resource(endpoint, 'about'), authorization, { method: 'GET' }, async response => {
    const about = await json(response, 64 * 1024)
    insist(about && Array.isArray(about.version) && about.version.every((version: unknown) => typeof version === 'string') && about.version.includes(VERSION), 'xapi_lrs_version_unsupported', 502)
    return { versions: about.version }
  }, true)
}
