import { t, localeNumber } from '../messages'
// ORG-007 on the pages: the learner's catalog (search and filters, required and optional work, enroll, request,
// withdraw, favorites and saved searches), the requests waiting for whoever decides them, and the course page's
// enrollment setting for whoever manages its catalog.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { catalog, catalogQuery, waitingRequests } from '../catalog'
import { area, card, checks, field, form, h, hidden, page, rows, select, when } from './html'

const MODE: Record<string, string> = { assigned: 'Only by assignment', open: 'Anyone offered it may enroll', request: 'Enrollment needs approval' }
const STANDING: Record<string, string> = { required: 'Required for you', optional: 'Optional: you enrolled', requested: 'Requested' }

export async function catalogPage(env: Bindings, actor: Actor, url: URL) {
  const query = catalogQuery(url)
  const [view, waiting] = await Promise.all([catalog(env, actor, query), waitingRequests(env, actor)])
  const zone = actor.shell!.zone
  const options = (values: string[]) => values.map(value => ({ value, label: value }))
  const filters = h`<form class="card filters" method="get" action="/app/catalog">
${field(t(actor, 'Search'), 'q', { value: query.q, required: false })}${select(t(actor, 'Subject'), 'subject', options(view.facets.subjects), query.subject, { required: false, blank: t(actor, 'Any subject') })}${select(t(actor, 'Skill'), 'skill', options(view.facets.skills), query.skill, { required: false, blank: t(actor, 'Any skill') })}${select(t(actor, 'Role'), 'role', view.facets.roles.map(role => ({ value: role.id, label: role.name })), query.role, { required: false, blank: t(actor, 'Any role') })}${select(t(actor, 'Language'), 'language', options(view.facets.languages), query.language, { required: false, blank: t(actor, 'Any language') })}${field(t(actor, 'At most (minutes)'), 'maxMinutes', { type: 'number', value: query.maxMinutes ?? '', required: false })}
<div class="filter-actions"><button type="submit">${t(actor, 'Search')}</button></div></form>`
  const saveForm = form('catalog.search', `/app/catalog${url.search}`, [...(['q', 'subject', 'skill', 'role', 'language'] as const).map(key => hidden(key, query[key])), hidden('maxMinutes', query.maxMinutes ?? ''), field(t(actor, 'Name this search'), 'name')], t(actor, 'Save search'), { secondary: true })
  const action = (course: any) => course.standing === 'required' || course.standing === 'optional' ? h`<a href="/app/learn/${course.openAssignment}">${t(actor, 'Open course')}</a>`
    : course.standing === 'requested' ? '' : course.mode === 'open' ? form('catalog.enroll', '/app/learn/{id}', [hidden('course', course.id)], t(actor, 'Enroll'), { secondary: true })
    : form('catalog.request', '/app/catalog', [hidden('course', course.id), area(t(actor, 'Why you want it (optional)'), 'note', '', false)], t(actor, 'Request enrollment'), { secondary: true })
  const courses = card(t(actor, 'Courses ({n})', { n: localeNumber(actor, view.courses.length) }), view.courses.length ? rows(view.courses.map(course => ({ title: h`${course.title}${course.standing ? h` · <strong>${t(actor, STANDING[course.standing])}</strong>` : ''}`,
    meta: h`${[course.folder, course.tags.join(', '), course.language, course.durationMinutes ? t(actor, '{n} minutes', { n: localeNumber(actor, course.durationMinutes) }) : '', course.mode === 'request' ? t(actor, 'needs approval') : t(actor, 'open enrollment')].filter(Boolean).join(' · ')}${course.summary ? h`<br>${course.summary}` : ''}`,
    aside: h`<div class="stack">${action(course)}${form('catalog.favorite', `/app/catalog${url.search}`, [hidden('course', course.id), hidden('favorite', course.favorite ? 'false' : 'true')], course.favorite ? t(actor, 'Remove favorite') : t(actor, 'Favorite'), { secondary: true })}</div>` }))) : h`<p class="muted">${t(actor, 'No offered course matches.')}</p>`, { id: 'catalog-courses' })
  const work = card(t(actor, 'My work'), h`${rows([...view.required.map(row => ({ title: row.courseTitle, meta: t(actor, 'Required · due {date}', { date: when(row.dueAt, row.timezone, zone, actor.locale) }), href: `/app/learn/${row.id}` })),
    ...view.optional.map(row => ({ title: row.courseTitle, meta: t(actor, 'Optional'), aside: form('catalog.withdraw', '/app/catalog', [hidden('assignment', row.id)], t(actor, 'Withdraw'), { secondary: true }) })),
    ...view.withdrawn.map(row => ({ title: row.courseTitle, meta: t(actor, 'Withdrawn; your progress is kept'), href: `/app/learn/${row.id}` })),
    ...view.requests.map(row => ({ title: row.courseTitle, meta: `${t(actor, 'Request {state}', { state: t(actor, row.state) })}${row.reason ? `: ${row.reason}` : ''}${row.decidedByName ? ` (${row.decidedByName})` : ''}` }))])}`, { id: 'my-work' })
  const personal = view.favorites.length || view.searches.length ? card(t(actor, 'Saved for you'), rows([...view.favorites.map(course => ({ title: course.title, meta: t(actor, 'Favorite') })), ...view.searches.map(search => ({ title: search.name, meta: t(actor, 'Saved search'), href: `/app/catalog?${new URLSearchParams(Object.entries(search.query).filter(([, value]) => value !== null && value !== '').map(([key, value]) => [key, String(value)])).toString()}` }))]), { id: 'saved' }) : ''
  const decide = waiting.length ? card('Enrollment requests waiting for you', rows(waiting.map(row => ({ title: `${row.learnerName} — ${row.courseTitle}`, meta: h`${row.note || 'No note'} · ${when(row.requestedAt, zone)}`,
    aside: h`${form('catalog.decide', '/app/catalog', [hidden('request', row.id), hidden('decision', 'approve')], 'Approve', { secondary: true })}${form('catalog.decide', '/app/catalog', [hidden('request', row.id), hidden('decision', 'decline'), field('Reason', 'reason')], 'Decline', { secondary: true })}` }))), { id: 'requests' }) : ''
  const body = h`<h1>${t(actor, 'Course catalog')}</h1><p class="lede">${t(actor, 'Courses offered to you. Required work is assigned to you; what you enroll in yourself is optional and you can withdraw from it, keeping your progress.')}</p>${decide}${filters}${saveForm}<div class="split">${courses}<div class="stack">${work}${personal}</div></div>`
  return page(t(actor, 'Catalog'), actor, body, { current: '/app/catalog', url })
}

/** The course page: how it is offered in the catalog, for whoever manages its catalog details. */
export function enrollmentCard(id: string, settings: { enrollmentMode: string; catalogTeams: string[] }, teams: { id: string; name: string }[]) {
  return card('Catalog enrollment', form('course.enrollment', `/app/courses/${id}`, [hidden('course', id), select('Offered', 'mode', Object.entries(MODE).map(([value, label]) => ({ value, label })), settings.enrollmentMode),
    teams.length ? checks('Only for these teams (none ticked: everyone)', 'teams', teams.map(team => ({ value: team.id, label: team.name })), settings.catalogTeams) : ''], 'Save enrollment', { secondary: true }), { id: 'enrollment' })
}
