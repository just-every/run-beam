// Beam's deliberately bounded Activity/Agent bridge, based on ADL xAPI 1.0.3:
// https://github.com/adlnet/xAPI-Spec/blob/1.0.3/xAPI-Data.md
// https://github.com/adlnet/xAPI-Spec/blob/1.0.3/xAPI-Communication.md
import { BeamError, insist, sha256Hex } from '../core'

export type XapiStatement = Record<string, any>
export type XapiAttachment = { sha256: string; contentType: string; bytes: Uint8Array }
export type XapiBatch = { statements: XapiStatement[]; attachments: XapiAttachment[] }
export type XapiExpected = { actor: { account: { homePage: string; name: string } }; activity: string; registration: string }
export const XAPI_JSON_LIMIT = 2 * 1024 * 1024
export const XAPI_ATTACHMENT_LIMIT = 10 * 1024 * 1024
const MAX_PARTS = 100
const HEADER_LIMIT = 16 * 1024
const encoder = new TextEncoder()
const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value)
const has = (value: object, key: string) => Object.hasOwn(value, key)
const fields = (value: Record<string, any>, allowed: string[]) => insist(Object.keys(value).every(key => allowed.includes(key)), 'xapi_unknown_property')

export function normalizeUuid(value: unknown): string {
  insist(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), 'xapi_invalid_uuid')
  return value.toLowerCase()
}

function iri(value: unknown) {
  insist(typeof value === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(value) && !/[\s\u0000-\u0020<>"{}|\\^`\u007f-\u009f]/u.test(value) && !/%(?![a-f0-9]{2})/i.test(value), 'xapi_invalid_iri')
  try { new URL(value) } catch { throw new BeamError('xapi_invalid_iri') }
}

function languageMap(value: unknown, required = false) {
  insist(record(value) && (!required || Object.keys(value).length > 0), 'xapi_invalid_language_map')
  for (const [language, text] of Object.entries(value)) {
    insist(/^(?:[a-z]{2,8}(?:-[a-z0-9]{1,8})*|x(?:-[a-z0-9]{1,8})+)$/i.test(language) && typeof text === 'string', 'xapi_invalid_language_map')
  }
}

function extensions(value: unknown) {
  insist(record(value), 'xapi_invalid_extensions')
  Object.keys(value).forEach(iri)
}

function timestamp(value: unknown) {
  insist(typeof value === 'string', 'xapi_invalid_timestamp')
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  insist(match, 'xapi_invalid_timestamp')
  const [, year, month, day, hour, minute, second, , zoneHour, zoneMinute] = match
  const numericYear = Number(year)
  const leap = numericYear % 4 === 0 && (numericYear % 100 !== 0 || numericYear % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1]
  insist(Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= days && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59 && Number(zoneHour ?? 0) <= 23 && Number(zoneMinute ?? 0) <= 59 && Number.isFinite(Date.parse(value)), 'xapi_invalid_timestamp')
}

function activity(value: unknown) {
  insist(record(value), 'xapi_invalid_activity')
  fields(value, ['objectType', 'id', 'definition'])
  insist(!has(value, 'objectType') || value.objectType === 'Activity', 'xapi_activity_required')
  iri(value.id)
  if (!has(value, 'definition')) return
  const definition = value.definition
  insist(record(definition), 'xapi_invalid_definition')
  fields(definition, ['name', 'description', 'type', 'moreInfo', 'interactionType', 'correctResponsesPattern', 'choices', 'scale', 'source', 'target', 'steps', 'extensions'])
  for (const key of ['name', 'description']) if (has(definition, key)) languageMap(definition[key])
  for (const key of ['type', 'moreInfo']) if (has(definition, key)) iri(definition[key])
  if (has(definition, 'extensions')) extensions(definition.extensions)
  if (has(definition, 'interactionType')) insist(['true-false', 'choice', 'fill-in', 'long-fill-in', 'matching', 'performance', 'sequencing', 'likert', 'numeric', 'other'].includes(definition.interactionType), 'xapi_invalid_interaction')
  if (has(definition, 'correctResponsesPattern')) insist(Array.isArray(definition.correctResponsesPattern) && definition.correctResponsesPattern.every((item: unknown) => typeof item === 'string'), 'xapi_invalid_interaction')
  for (const key of ['choices', 'scale', 'source', 'target', 'steps']) {
    if (!has(definition, key)) continue
    insist(Array.isArray(definition[key]), 'xapi_invalid_interaction')
    const ids = new Set<string>()
    for (const component of definition[key]) {
      insist(record(component) && typeof component.id === 'string' && !ids.has(component.id), 'xapi_invalid_interaction')
      fields(component, ['id', 'description'])
      ids.add(component.id)
      if (has(component, 'description')) languageMap(component.description)
    }
  }
}

function accountAgent(value: unknown) {
  insist(record(value) && (!has(value, 'objectType') || value.objectType === 'Agent'), 'xapi_agent_required')
  fields(value, ['objectType', 'name', 'account'])
  insist(record(value.account) && typeof value.account.name === 'string' && value.account.name.length > 0, 'xapi_account_required')
  fields(value.account, ['homePage', 'name'])
  iri(value.account.homePage)
  if (has(value, 'name')) insist(typeof value.name === 'string', 'xapi_invalid_agent_name')
}

function attachmentMetadata(value: unknown) {
  insist(record(value), 'xapi_invalid_attachment')
  fields(value, ['usageType', 'display', 'description', 'contentType', 'length', 'sha2', 'fileUrl'])
  // External URLs are intentionally outside this bridge's data-sharing contract.
  insist(!has(value, 'fileUrl'), 'xapi_external_attachment_forbidden')
  iri(value.usageType)
  languageMap(value.display, true)
  if (has(value, 'description')) languageMap(value.description)
  insist(validContentType(value.contentType), 'xapi_invalid_attachment_type')
  insist(Number.isSafeInteger(value.length) && value.length >= 0 && value.length <= XAPI_ATTACHMENT_LIMIT, 'xapi_invalid_attachment_length')
  insist(typeof value.sha2 === 'string' && /^[a-f0-9]{64}$/i.test(value.sha2), 'xapi_invalid_attachment_hash')
}

function validContentType(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && !/[\r\n\u0000-\u001f\u007f]/.test(value) && /^[!#$%&'*+.^_`|~a-z0-9-]+\/[!#$%&'*+.^_`|~a-z0-9-]+(?:\s*;\s*[!#$%&'*+.^_`|~a-z0-9-]+=(?:[!#$%&'*+.^_`|~a-z0-9-]+|"[^"\\]*"))*$/i.test(value)
}

function result(value: unknown) {
  insist(record(value), 'xapi_invalid_result')
  fields(value, ['score', 'success', 'completion', 'response', 'duration', 'extensions'])
  for (const key of ['success', 'completion']) if (has(value, key)) insist(typeof value[key] === 'boolean', 'xapi_invalid_result_boolean')
  if (has(value, 'response')) insist(typeof value.response === 'string', 'xapi_invalid_response')
  if (has(value, 'duration')) insist(typeof value.duration === 'string' && /^P(?=\d|T\d)(?:\d+(?:[.,]\d+)?W|(?:\d+(?:[.,]\d+)?Y)?(?:\d+(?:[.,]\d+)?M)?(?:\d+(?:[.,]\d+)?D)?(?:T(?=\d)(?:\d+(?:[.,]\d+)?H)?(?:\d+(?:[.,]\d+)?M)?(?:\d+(?:[.,]\d+)?S)?)?)$/.test(value.duration), 'xapi_invalid_duration')
  if (has(value, 'extensions')) extensions(value.extensions)
  if (!has(value, 'score')) return
  const score = value.score
  insist(record(score), 'xapi_invalid_score')
  fields(score, ['scaled', 'raw', 'min', 'max'])
  for (const number of Object.values(score)) insist(typeof number === 'number' && Number.isFinite(number), 'xapi_invalid_score')
  if (has(score, 'scaled')) insist(score.scaled >= -1 && score.scaled <= 1, 'xapi_score_bounds')
  if (has(score, 'min') && has(score, 'max')) insist(score.min < score.max, 'xapi_score_bounds')
  if (has(score, 'raw') && has(score, 'min')) insist(score.raw >= score.min, 'xapi_score_bounds')
  if (has(score, 'raw') && has(score, 'max')) insist(score.raw <= score.max, 'xapi_score_bounds')
}

/** Validates the supported bridge profile and returns a clone; original evidence is untouched. */
export function validateStatement(statement: XapiStatement, expected: XapiExpected): XapiStatement {
  insist(record(statement), 'xapi_invalid_statement')
  // Check JSON values/depth before cloning or traversing the supplied value.
  canonicalJSON(statement)
  insist(!has(statement, 'authority'), 'xapi_authority_forbidden')
  fields(statement, ['id', 'actor', 'verb', 'object', 'result', 'context', 'timestamp', 'stored', 'version', 'attachments'])
  const id = normalizeUuid(statement.id)
  accountAgent(statement.actor)
  insist(statement.actor.account.homePage === expected.actor.account.homePage && statement.actor.account.name === expected.actor.account.name, 'xapi_actor_mismatch', 403)
  insist(record(statement.verb), 'xapi_invalid_verb')
  fields(statement.verb, ['id', 'display'])
  iri(statement.verb.id)
  if (has(statement.verb, 'display')) languageMap(statement.verb.display)
  activity(statement.object)
  insist(statement.object.id === expected.activity, 'xapi_activity_mismatch', 403)
  insist(record(statement.context), 'xapi_context_required')
  const context = statement.context
  fields(context, ['registration', 'instructor', 'team', 'contextActivities', 'revision', 'platform', 'language', 'statement', 'extensions'])
  const registration = normalizeUuid(context.registration)
  insist(registration === normalizeUuid(expected.registration), 'xapi_registration_mismatch', 403)
  insist(!has(context, 'team') && !has(context, 'statement'), 'xapi_unsupported_context')
  if (has(context, 'instructor')) accountAgent(context.instructor)
  for (const key of ['revision', 'platform', 'language']) if (has(context, key)) insist(typeof context[key] === 'string', 'xapi_invalid_context')
  if (has(context, 'language')) languageMap({ [context.language]: '' })
  if (has(context, 'extensions')) extensions(context.extensions)
  if (has(context, 'contextActivities')) {
    insist(record(context.contextActivities), 'xapi_invalid_context_activities')
    fields(context.contextActivities, ['parent', 'grouping', 'category', 'other'])
    for (const activities of Object.values(context.contextActivities)) {
      insist(Array.isArray(activities) && activities.length > 0, 'xapi_invalid_context_activities')
      activities.forEach(activity)
    }
  }
  timestamp(statement.timestamp)
  insist(Date.parse(statement.timestamp) <= Date.now(), 'xapi_future_timestamp')
  if (has(statement, 'stored')) timestamp(statement.stored)
  if (has(statement, 'version')) insist(statement.version === '1.0.0', 'xapi_invalid_statement_version')
  if (has(statement, 'result')) result(statement.result)
  if (has(statement, 'attachments')) {
    insist(Array.isArray(statement.attachments) && statement.attachments.length < MAX_PARTS, 'xapi_invalid_attachments')
    statement.attachments.forEach(attachmentMetadata)
  }
  const normalized = structuredClone(statement)
  normalized.id = id
  normalized.context.registration = registration
  for (const attachment of normalized.attachments ?? []) attachment.sha2 = attachment.sha2.toLowerCase()
  return normalized
}

/** Only explicit success AND completion in one validated statement can match a trusted rule. */
export function statementOutcome(statement: XapiStatement): 'passed' | 'failed' | 'incomplete' | 'unmapped' {
  const value = statement.result
  if (value?.success === false) return 'failed'
  if (value?.completion === false) return 'incomplete'
  return value?.completion === true && value?.success === true ? 'passed' : 'unmapped'
}

/** Recursive key ordering is for evidence deduplication, never a replacement for original JSON. */
export function canonicalJSON(value: unknown, depth = 0): string {
  insist(depth <= 64, 'xapi_json_depth')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') { insist(Number.isFinite(value), 'xapi_invalid_json'); return JSON.stringify(value) }
  if (Array.isArray(value)) return `[${value.map(item => canonicalJSON(item, depth + 1)).join(',')}]`
  insist(record(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'xapi_invalid_json')
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key], depth + 1)}`).join(',')}}`
}

export async function statementDigest(statement: XapiStatement): Promise<string> {
  const normalized: XapiStatement = { ...statement, id: normalizeUuid(statement.id) }
  if (record(statement.context) && has(statement.context, 'registration')) normalized.context = { ...statement.context, registration: normalizeUuid(statement.context.registration) }
  return sha256Hex(encoder.encode(canonicalJSON(normalized)))
}

export async function readBoundedBytes(message: Request | Response, limit: number): Promise<Uint8Array> {
  const length = message.headers.get('content-length')
  if (length !== null) insist(/^\d+$/.test(length) && Number(length) <= limit, 'xapi_body_too_large', 413)
  if (!message.body) return new Uint8Array()
  const reader = message.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      insist(size <= limit, 'xapi_body_too_large', 413)
      chunks.push(next.value)
    }
  } catch (error) {
    void reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

export function parseXapiJson(bytes: Uint8Array): any {
  insist(bytes.length <= XAPI_JSON_LIMIT, 'xapi_json_too_large', 413)
  let source: string, parsed: any
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); parsed = JSON.parse(source) } catch { throw new BeamError('xapi_invalid_json') }
  // JSON.parse discards duplicate keys. Reject them, including escaped spellings,
  // before identity or result fields can acquire two interpretations.
  const stack: (Set<string> | null)[] = []
  for (const token of source.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\]]/g)) {
    const text = token[0]
    if (text === '{' || text === '[') { stack.push(text === '{' ? new Set() : null); insist(stack.length <= 64, 'xapi_json_depth') }
    else if (text === '}' || text === ']') stack.pop()
    else {
      let next = token.index! + text.length
      while (/\s/.test(source[next] ?? '') && next < source.length) next++
      if (source[next] !== ':') continue
      const key: string = JSON.parse(text), keys = stack[stack.length - 1]
      insist(keys && !keys.has(key), 'xapi_duplicate_property')
      keys.add(key)
    }
  }
  canonicalJSON(parsed)
  return parsed
}

function statements(value: unknown): XapiStatement[] {
  const list = Array.isArray(value) ? value : [value]
  insist(list.length > 0 && list.length <= 20 && list.every(record), 'xapi_invalid_statement_batch')
  return list
}

function findBytes(bytes: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let index = from; index <= bytes.length - needle.length; index++) {
    if (bytes[index] !== needle[0]) continue
    for (let offset = 1; offset < needle.length; offset++) if (bytes[index + offset] !== needle[offset]) continue outer
    return index
  }
  return -1
}

/** Also used by the outbound client: no missing, extra, duplicate or corrupt bytes. */
export async function validateAttachmentParts(list: XapiStatement[], attachments: XapiAttachment[]): Promise<void> {
  const parts = new Map<string, XapiAttachment>()
  let size = 0
  insist(attachments.length < MAX_PARTS, 'xapi_too_many_parts')
  for (const part of attachments) {
    insist(typeof part.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(part.sha256) && part.bytes instanceof Uint8Array && validContentType(part.contentType), 'xapi_invalid_attachment')
    const hash = part.sha256.toLowerCase()
    size += part.bytes.length
    insist(size <= XAPI_ATTACHMENT_LIMIT, 'xapi_attachments_too_large', 413)
    insist(!parts.has(hash), 'xapi_duplicate_attachment')
    insist(await sha256Hex(part.bytes) === hash, 'xapi_attachment_hash_mismatch')
    parts.set(hash, part)
  }
  const used = new Set<string>()
  for (const statement of list) {
    insist(!has(statement, 'attachments') || Array.isArray(statement.attachments), 'xapi_invalid_attachments')
    for (const metadata of statement.attachments ?? []) {
      attachmentMetadata(metadata)
      const hash = metadata.sha2.toLowerCase(), part = parts.get(hash)
      insist(part && metadata.length === part.bytes.length && metadata.contentType.trim() === part.contentType.trim(), 'xapi_attachment_part_mismatch')
      used.add(hash)
    }
  }
  insist(used.size === parts.size, 'xapi_unreferenced_attachment')
}

export async function parseXapiRequest(request: Request | Response): Promise<XapiBatch> {
  const type = request.headers.get('content-type') ?? ''
  const baseType = type.split(';', 1)[0].trim().toLowerCase()
  insist(baseType === 'application/json' || baseType === 'multipart/mixed', 'xapi_unsupported_content_type', 415)
  const bytes = await readBoundedBytes(request, baseType === 'application/json' ? XAPI_JSON_LIMIT : XAPI_JSON_LIMIT + XAPI_ATTACHMENT_LIMIT + 128 * 1024)
  if (baseType === 'application/json') {
    const list = statements(parseXapiJson(bytes))
    await validateAttachmentParts(list, [])
    return { statements: list, attachments: [] }
  }
  const boundaries = [...type.matchAll(/(?:^|;)\s*boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/gi)]
  insist(boundaries.length === 1, 'xapi_invalid_boundary')
  const boundary = boundaries[0][1] ?? boundaries[0][2]
  insist(/^[0-9a-z'()+_,./:=? -]{1,70}$/i.test(boundary) && !boundary.endsWith(' '), 'xapi_invalid_boundary')
  const marker = encoder.encode(`--${boundary}`), separator = encoder.encode('\r\n\r\n')
  function delimiter(from: number): { index: number; end: number; closing: boolean } | null {
    for (let index = findBytes(bytes, marker, from); index >= 0; index = findBytes(bytes, marker, index + marker.length)) {
      if (index !== 0 && (bytes[index - 2] !== 13 || bytes[index - 1] !== 10)) continue
      let end = index + marker.length
      const closing = bytes[end] === 45 && bytes[end + 1] === 45
      if (closing) end += 2
      while (bytes[end] === 32 || bytes[end] === 9) end++
      if (closing && end === bytes.length) return { index, end, closing }
      if (bytes[end] === 13 && bytes[end + 1] === 10) return { index, end: end + 2, closing }
    }
    return null
  }
  let current = delimiter(0), list: XapiStatement[] | undefined, count = 0
  const attachments: XapiAttachment[] = []
  let attachmentSize = 0
  insist(current && current.index <= HEADER_LIMIT && !current.closing, 'xapi_invalid_multipart')
  for (;;) {
    insist(++count <= MAX_PARTS, 'xapi_too_many_parts')
    const headerEnd = findBytes(bytes, separator, current.end)
    insist(headerEnd >= current.end && headerEnd - current.end <= HEADER_LIMIT, 'xapi_invalid_part_headers')
    let headerText: string
    try { headerText = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(current.end, headerEnd)) } catch { throw new BeamError('xapi_invalid_part_headers') }
    const headers = new Map<string, string>()
    for (const line of headerText.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
      const match = /^([!#$%&'*+.^_`|~a-z0-9-]+):[ \t]*([^\r\n\u0000-\u001f\u007f]*)$/i.exec(line)
      insist(match && !headers.has(match[1].toLowerCase()), 'xapi_invalid_part_headers')
      headers.set(match[1].toLowerCase(), match[2].trim())
    }
    const next = delimiter(headerEnd + separator.length)
    insist(next, 'xapi_invalid_multipart')
    insist(next.index >= headerEnd + separator.length + 2, 'xapi_invalid_multipart')
    const data = bytes.slice(headerEnd + separator.length, next.index - 2)
    const contentLength = headers.get('content-length')
    if (contentLength !== undefined) insist(/^\d+$/.test(contentLength) && Number(contentLength) === data.length, 'xapi_attachment_length_mismatch')
    const transfer = headers.get('content-transfer-encoding')
    insist(transfer === undefined || transfer.toLowerCase() === 'binary', 'xapi_unsupported_transfer_encoding')
    const contentType = headers.get('content-type') ?? ''
    if (!list) {
      insist(contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json', 'xapi_json_part_required')
      list = statements(parseXapiJson(data))
    } else {
      const hash = headers.get('x-experience-api-hash') ?? ''
      insist(/^[a-f0-9]{64}$/i.test(hash) && validContentType(contentType), 'xapi_invalid_attachment_headers')
      attachmentSize += data.length
      insist(attachmentSize <= XAPI_ATTACHMENT_LIMIT, 'xapi_attachments_too_large', 413)
      attachments.push({ sha256: hash.toLowerCase(), contentType, bytes: data })
    }
    if (next.closing) { insist(bytes.length - next.end <= HEADER_LIMIT, 'xapi_invalid_multipart'); break }
    current = next
  }
  insist(list, 'xapi_json_part_required')
  await validateAttachmentParts(list, attachments)
  return { statements: list, attachments }
}
