// Structured lesson content. Uploaded HTML is never a renderer or an embed.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { auditVia, insist, newId, now, one, stmt } from './core'
import type { Input } from './input'
export const BLOCK_KINDS = ['text', 'image', 'audio', 'video', 'document', 'link', 'check', 'embed', 'lti'] as const
export interface Block {
  id: string; kind: typeof BLOCK_KINDS[number]; text: string; source?: string; url?: string
  resource?: string; passPercent?: number;
  choices?: string[]; answer?: number; feedback?: string
  copiedFrom?: { course: string; lesson: string; block: string; courseTitle?: string; lessonTitle?: string }
}
export async function embedPolicy(env: Bindings) {
  const row = await one(env, 'SELECT hosts, version FROM beam_embed_policy WHERE id = 1')
  return { hosts: row ? JSON.parse(row.hosts) as string[] : [], version: row?.version ?? 0 }
}
function host(value: string) {
  insist(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(value), 'invalid_embed_host')
  return value
}
export async function saveEmbedPolicy(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const hosts = [...new Set(input.text('hosts', { max: 4000, optional: true }).toLowerCase().split(/[\s,]+/).filter(Boolean).map(host))]
  insist(hosts.length <= 30 && !hosts.includes(new URL(env.AUTH_ORIGIN).hostname), 'invalid_embed_host')
  const expected = input.integer('version', { max: 1_000_000 })!
  const result = await env.DB.batch([
    stmt(env, 'INSERT INTO beam_embed_policy (id, hosts, version) SELECT 1, ?, 1 WHERE ? = 0 OR EXISTS (SELECT 1 FROM beam_embed_policy WHERE id = 1 AND version = ?) ON CONFLICT(id) DO UPDATE SET hosts = excluded.hosts, version = beam_embed_policy.version + 1 WHERE beam_embed_policy.version = ?', JSON.stringify(hosts), expected, expected, expected),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail, via) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1', now(), actor.id, 'embed.policy', 'lesson-embeds', JSON.stringify({ hosts, version: expected + 1 }), auditVia(actor)),
  ])
  insist(result[0].meta.changes === 1, 'stale_embed_policy', 409)
  return { hosts, version: expected + 1 }
}
export function safeUrl(value: string) {
  let url: URL
  try { url = new URL(value) } catch { insist(false, 'invalid_media_url') }
  insist(url!.protocol === 'https:' && !url!.username && !url!.password && !url!.port, 'invalid_media_url')
  return url!
}
export function embedUrl(value: string) {
  const url = safeUrl(value)
  if (url.hostname === 'youtu.be') return `https://www.youtube.com/embed/${encodeURIComponent(url.pathname.slice(1))}`
  if (['youtube.com', 'www.youtube.com'].includes(url.hostname) && url.pathname === '/watch') {
    insist(url.searchParams.get('v'), 'invalid_media_url')
    return `https://www.youtube.com/embed/${encodeURIComponent(url.searchParams.get('v')!)}`
  }
  if (['loom.com', 'www.loom.com'].includes(url.hostname)) url.pathname = url.pathname.replace(/^\/share\//, '/embed/')
  if (url.hostname === 'vimeo.com' && /^\/\d+$/.test(url.pathname)) return `https://player.vimeo.com/video${url.pathname}`
  if (url.hostname === 'docs.google.com') {
    url.pathname = url.pathname.replace(/^(\/presentation\/d\/[^/]+)\/(?:edit|pub).*$/, '$1/embed').replace(/^(\/document\/d\/[^/]+)\/edit.*$/, '$1/preview')
    url.hash = ''
  }
  return url.href
}
export async function allowedEmbed(env: Bindings, value: string) {
  const url = safeUrl(embedUrl(value)), policy = await embedPolicy(env)
  insist(url.origin !== new URL(env.AUTH_ORIGIN).origin && policy.hosts.includes(url.hostname), 'embed_host_not_allowed')
  return url.href
}
export async function normaliseBlocks(env: Bindings, value: unknown, { admit = false } = {}): Promise<Block[]> {
  if (value === undefined) return []
  insist(Array.isArray(value) && value.length <= 60, 'invalid_blocks')
  const blocks: Block[] = []
  for (const item of value) {
    insist(item && BLOCK_KINDS.includes(item.kind) && typeof item.text === 'string' && item.text.trim() && item.text.length <= 10_000, 'invalid_block')
    insist(!/<\/?[a-z!][^>]*>/i.test(item.text), 'active_lesson_html')
    const block: Block = { id: typeof item.id === 'string' && item.id ? item.id : newId(), kind: item.kind, text: item.text.trim() }
    insist(!blocks.some(earlier => earlier.id === block.id), 'duplicate_block_id')
    if (['image', 'audio', 'video', 'document'].includes(block.kind)) {
      insist(typeof item.source === 'string', 'media_source_required')
      const source = await one(env, 'SELECT media_type FROM beam_source_versions WHERE id = ?', item.source)
      insist(source, 'source_version_not_found', 404)
      const prefix = { image: 'image/', audio: 'audio/', video: 'video/', document: 'application/pdf' }[block.kind as 'image' | 'audio' | 'video' | 'document']
      insist(source.media_type.startsWith(prefix), 'media_type_mismatch')
      block.source = item.source
    }
    if (block.kind === 'embed' || block.kind === 'link') {
      insist(typeof item.url === 'string' && item.url.length <= 2000, 'invalid_media_url')
      block.url = block.kind === 'embed' ? (admit ? await allowedEmbed(env, item.url) : safeUrl(embedUrl(item.url)).href) : safeUrl(item.url).href
    }
    if (block.kind === 'lti') {
      insist(typeof item.resource === 'string' && await one(env, 'SELECT 1 FROM beam_lti_resources WHERE id=? AND approved_by IS NOT NULL AND pass_percent=?', item.resource, item.passPercent), 'lti_resource_not_found', 404)
      insist(Number.isInteger(item.passPercent) && item.passPercent >= 1 && item.passPercent <= 100, 'invalid_lti_threshold')
      block.resource = item.resource; block.passPercent = item.passPercent
    }
    if (block.kind === 'check') {
      insist(Array.isArray(item.choices) && item.choices.length >= 2 && item.choices.length <= 8 && item.choices.every((choice: unknown) => typeof choice === 'string' && choice.trim() && choice.length <= 500), 'invalid_check_choices')
      insist(Number.isInteger(item.answer) && item.answer >= 0 && item.answer < item.choices.length, 'invalid_check_answer')
      insist(typeof item.feedback === 'string' && item.feedback.length <= 2000, 'invalid_check_feedback')
      block.choices = item.choices.map((choice: string) => choice.trim()); block.answer = item.answer; block.feedback = item.feedback
    }
    if (item.copiedFrom) {
      insist(['course', 'lesson', 'block'].every(key => typeof item.copiedFrom[key] === 'string' && item.copiedFrom[key].length <= 200), 'invalid_block_attribution')
      for (const key of ['courseTitle', 'lessonTitle']) insist(item.copiedFrom[key] === undefined || (typeof item.copiedFrom[key] === 'string' && item.copiedFrom[key].length <= 160), 'invalid_block_attribution')
      block.copiedFrom = { course: item.copiedFrom.course, lesson: item.copiedFrom.lesson, block: item.copiedFrom.block, courseTitle: item.copiedFrom.courseTitle, lessonTitle: item.copiedFrom.lessonTitle }
    }
    blocks.push(block)
  }
  return blocks
}
