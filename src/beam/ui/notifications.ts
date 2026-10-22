import { t } from '../messages'
// NOTICE-005 uses Beam's existing forms, cards and private My learning surface.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all } from '../core'
import { listCourses } from '../courses'
import { notificationInbox } from '../notification-delivery'
import { notificationRulesView } from '../notification-rules'
import { area, card, field, form, h, hidden, page, rows, select, when } from './html'

export async function notificationsPage(env: Bindings, actor: Actor, url: URL) {
  const view = await notificationRulesView(env, actor), zone = actor.shell!.zone
  const [courses, teams] = await Promise.all([listCourses(env), all<{ id: string; name: string }>(env, 'SELECT id,name FROM beam_teams ORDER BY name')])
  const editor = (rule?: any) => {
    const variants = rule?.variants ?? { default: { subject: '{learner_name} completed {course_name}', body: '{learner_name} completed {course_name}. Learning record: {assignment_link}' } }
    const language = Object.keys(variants).find(key => key !== 'default') ?? 'es'
    return form('notification.save', '/app/notifications', [
      ...(rule ? [hidden('rule', rule.id), hidden('version', rule.version)] : []), field('Name', 'name', { value: rule?.name ?? '' }),
      select('Recipient', 'recipient', [{ value: 'manager', label: 'Current authorized team managers' }, { value: 'learner', label: 'The learner' }], rule?.recipient ?? 'manager'),
      select('Course', 'course', courses.map(c => ({ value: c.id, label: c.title })), rule?.course_id ?? '', { required: false, blank: 'Every course' }),
      select('Team', 'team', teams.map(t => ({ value: t.id, label: t.name })), rule?.team_id ?? '', { required: false, blank: 'Every team' }), field('Location', 'location', { value: rule?.location ?? '', required: false }),
      field('Default subject', 'subject', { value: variants.default.subject }), area('Default message', 'body', variants.default.body),
      field('Additional language tag', 'variantLanguage', { value: language, required: false, hint: 'For example es or es-us. Leave its subject and message empty to use only the default.' }),
      field('Language subject', 'variantSubject', { value: variants[language]?.subject ?? '', required: false }), area('Language message', 'variantBody', variants[language]?.body ?? '', false),
    ], rule ? 'Save new version' : 'Save notification')
  }
  return page('Notification rules', actor, h`<h1>Notification rules</h1><p class="lede">Course completion notices, recorded in Beam only. No email, SMS, Slack or Teams message is sent. Current manager means a current team manager or their covering manager, with access checked again when they read it.</p>
${card('Messages and languages', h`<p>Use {learner_name}, {course_name}, {due_date} and {assignment_link}. Text stays plain and unknown fields are refused. Language follows the recipient: exact tag, then base language, then default. Test each version in your own inbox before enabling it. Saving a new version switches the rule off.</p><p>Quiet hours, daily limits, per-event approval and the kill switch are on <a href="/app/automation">Automation</a>. Held events wait for Replay; there is no automatic retry.</p>`)}
${view.rules.map(rule => card(rule.name, h`<p>Completion → ${rule.recipient === 'learner' ? 'learner' : 'current managers'} · version ${rule.version} · ${rule.enabled ? 'On' : 'Off'} · in Beam only</p>
${form('notification.test', '/app/notifications', [hidden('rule', rule.id)], 'Test in my inbox', { secondary: true })}
${form('notification.state', '/app/notifications', [hidden('rule', rule.id), hidden('enabled', rule.enabled ? 'false' : 'true')], rule.enabled ? 'Turn off' : 'Turn on', { secondary: true })}
${rule.enabled ? form('notification.replay', '/app/notifications', [hidden('rule', rule.id)], 'Replay matching events', { secondary: true }) : ''}
<details><summary>Edit message and filters</summary>${editor(rule)}</details>`))}
${card('New completion notice', editor())}
${view.messages.length ? card('Recorded notices', rows(view.messages.map(message => ({ title: message.subject, meta: `${message.test ? 'Test · ' : ''}${message.recipientName} · version ${message.version} · ${message.language} · in Beam · ${when(message.at, zone)}` })))) : ''}`, { current: '/app/notifications', url })
}

export async function notificationCard(env: Bindings, actor: Actor, zone: string) {
  const messages = await notificationInbox(env, actor)
  if (!messages.length) return ''
  return card(t(actor, 'Notifications'), messages.map(message => h`<section class="announcement"><h3>${message.subject}</h3><p class="muted">${message.test ? t(actor, 'Test in your inbox · ') : ''}${t(actor, 'Recorded in Beam')} · ${when(message.at, zone, zone, actor.locale)}</p><p>${message.body}</p><p><a href="${message.test ? '/app/learning' : message.assignmentId ? `/app/learn/${message.assignmentId}` : `/app/records/${message.learner_id}`}">${t(actor, 'Open learning record')}</a></p></section>`), { id: 'notifications' })
}
