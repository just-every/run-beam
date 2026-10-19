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
${field('Search', 'q', { value: query.q, required: false })}${select('Subject', 'subject', options(view.facets.subjects), query.subject, { required: false, blank: 'Any subject' })}${select('Skill', 'skill', options(view.facets.skills), query.skill, { required: false, blank: 'Any skill' })}${select('Role', 'role', view.facets.roles.map(role => ({ value: role.id, label: role.name })), query.role, { required: false, blank: 'Any role' })}${select('Language', 'language', options(view.facets.languages), query.language, { required: false, blank: 'Any language' })}${field('At most (minutes)', 'maxMinutes', { type: 'number', value: query.maxMinutes ?? '', required: false })}
<div class="filter-actions"><button type="submit">Search</button></div></form>`
  const saveForm = form('catalog.search', `/app/catalog${url.search}`, [...(['q', 'subject', 'skill', 'role', 'language'] as const).map(key => hidden(key, query[key])), hidden('maxMinutes', query.maxMinutes ?? ''), field('Name this search', 'name')], 'Save search', { secondary: true })
  const action = (course: any) => course.standing === 'required' || course.standing === 'optional' ? h`<a href="/app/learn/${course.openAssignment}">Open</a>`
    : course.standing === 'requested' ? '' : course.mode === 'open' ? form('catalog.enroll', '/app/learn/{id}', [hidden('course', course.id)], 'Enroll', { secondary: true })
    : form('catalog.request', '/app/catalog', [hidden('course', course.id), area('Why you want it (optional)', 'note', '', false)], 'Request enrollment', { secondary: true })
  const courses = card(`Courses (${view.courses.length})`, view.courses.length ? rows(view.courses.map(course => ({ title: h`${course.title}${course.standing ? h` · <strong>${STANDING[course.standing]}</strong>` : ''}`,
    meta: h`${[course.folder, course.tags.join(', '), course.language, course.durationMinutes ? `${course.durationMinutes} minutes` : '', course.mode === 'request' ? 'needs approval' : 'open enrollment'].filter(Boolean).join(' · ')}${course.summary ? h`<br>${course.summary}` : ''}`,
    aside: h`${action(course)}${form('catalog.favorite', `/app/catalog${url.search}`, [hidden('course', course.id), hidden('favorite', course.favorite ? 'false' : 'true')], course.favorite ? 'Remove favorite' : 'Favorite', { secondary: true })}` }))) : h`<p class="muted">No offered course matches.</p>`, { id: 'catalog-courses' })
  const work = card('My work', h`${rows([...view.required.map(row => ({ title: row.courseTitle, meta: `Required · due ${when(row.dueAt, row.timezone, zone)}`, href: `/app/learn/${row.id}` })),
    ...view.optional.map(row => ({ title: row.courseTitle, meta: 'Optional', aside: form('catalog.withdraw', '/app/catalog', [hidden('assignment', row.id)], 'Withdraw', { secondary: true }) })),
    ...view.withdrawn.map(row => ({ title: row.courseTitle, meta: 'Withdrawn; your progress is kept', href: `/app/learn/${row.id}` })),
    ...view.requests.map(row => ({ title: row.courseTitle, meta: `Request ${row.state}${row.reason ? `: ${row.reason}` : ''}${row.decidedByName ? ` (${row.decidedByName})` : ''}` }))])}`, { id: 'my-work' })
  const personal = view.favorites.length || view.searches.length ? card('Saved for you', rows([...view.favorites.map(course => ({ title: course.title, meta: 'Favorite' })), ...view.searches.map(search => ({ title: search.name, meta: 'Saved search', href: `/app/catalog?${new URLSearchParams(Object.entries(search.query).filter(([, value]) => value !== null && value !== '').map(([key, value]) => [key, String(value)])).toString()}` }))]), { id: 'saved' }) : ''
  const decide = waiting.length ? card('Enrollment requests waiting for you', rows(waiting.map(row => ({ title: `${row.learnerName} — ${row.courseTitle}`, meta: h`${row.note || 'No note'} · ${when(row.requestedAt, zone)}`,
    aside: h`${form('catalog.decide', '/app/catalog', [hidden('request', row.id), hidden('decision', 'approve')], 'Approve', { secondary: true })}${form('catalog.decide', '/app/catalog', [hidden('request', row.id), hidden('decision', 'decline'), field('Reason', 'reason')], 'Decline', { secondary: true })}` }))), { id: 'requests' }) : ''
  const body = h`<h1>Course catalog</h1><p class="lede">Courses offered to you. Required work is assigned to you; what you enroll in yourself is optional and you can withdraw from it, keeping your progress.</p>${decide}${filters}${saveForm}<div class="split">${courses}<div class="stack">${work}${personal}</div></div>`
  return page('Catalog', actor, body, { current: '/app/catalog', url })
}

/** The course page: how it is offered in the catalog, for whoever manages its catalog details. */
export function enrollmentCard(id: string, settings: { enrollmentMode: string; catalogTeams: string[] }, teams: { id: string; name: string }[]) {
  return card('Catalog enrollment', form('course.enrollment', `/app/courses/${id}`, [hidden('course', id), select('Offered', 'mode', Object.entries(MODE).map(([value, label]) => ({ value, label })), settings.enrollmentMode),
    teams.length ? checks('Only for these teams (none ticked: everyone)', 'teams', teams.map(team => ({ value: team.id, label: team.name })), settings.catalogTeams) : ''], 'Save enrollment', { secondary: true }), { id: 'enrollment' })
}
