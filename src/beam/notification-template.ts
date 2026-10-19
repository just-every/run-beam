// NOTICE-005: templates are plain text. Only this vocabulary is interpolated;
// callers still escape the resulting text when rendering HTML.
import { insist } from './core'

export const NOTICE_FIELDS = ['learner_name', 'course_name', 'due_date', 'assignment_link'] as const
export type NoticeValues = Record<typeof NOTICE_FIELDS[number], string>

export function validateNoticeTemplate(text: string) {
  const stripped = text.replace(/\{([a-z_]+)\}/g, (_match, field: string) => {
    insist(NOTICE_FIELDS.includes(field as typeof NOTICE_FIELDS[number]), 'unknown_merge_field', 400, { field })
    return ''
  })
  insist(!/[{}]/.test(stripped), 'unknown_merge_field')
  return text
}

export function renderNotice(text: string, values: NoticeValues) {
  return validateNoticeTemplate(text).replace(/\{([a-z_]+)\}/g, (_match, field: keyof NoticeValues) => values[field])
}

export function noticeVariant(variants: Record<string, { subject: string; body: string }>, language: string) {
  const tag = language.toLowerCase()
  return variants[tag] ?? variants[tag.split('-')[0]] ?? variants.default
}

export function validateNoticeVariants(value: unknown) {
  insist(value && typeof value === 'object' && !Array.isArray(value), 'invalid_variants')
  const variants: Record<string, { subject: string; body: string }> = {}
  for (const [language, variant] of Object.entries(value)) {
    insist(/^(default|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/.test(language), 'invalid_notice_language')
    insist(variant && typeof variant === 'object' && !Array.isArray(variant), 'invalid_variants')
    const { subject, body } = variant as { subject?: unknown; body?: unknown }
    insist(typeof subject === 'string' && subject.trim().length > 0 && subject.length <= 200, 'invalid_notice_subject')
    insist(typeof body === 'string' && body.trim().length > 0 && body.length <= 5000, 'invalid_notice_body')
    variants[language] = { subject: validateNoticeTemplate(subject), body: validateNoticeTemplate(body) }
  }
  insist(variants.default && Object.keys(variants).length <= 20, 'default_variant_required')
  return variants
}
