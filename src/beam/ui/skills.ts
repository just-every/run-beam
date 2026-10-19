// LEARN-007 pages: the skill taxonomy with its course and role mappings (/app/skills), and one person's
// recommendations with the inputs behind each (/app/skills/:member).
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all } from '../core'
import { listCourses } from '../courses'
import { inScope } from '../scope'
import { approvedPaths, recommendations } from '../recommendations'
import { skillTaxonomy } from '../skills'
import { formatDate } from '../time'
import { business } from '../people'
import { area, card, checks, field, form, h, hidden, page, rows, select } from './html'

const STATUS: Record<string, string> = { met: 'Met (recorded diagnostic)', assigned: 'Assigned learning in progress', needed: 'Needed', no_course: 'No further course mapped' }

export async function skillsPage(env: Bindings, actor: Actor, url: URL) {
  const { skills, courses, roles } = await skillTaxonomy(env)
  const name = new Map(skills.map(skill => [skill.id, skill.name]))
  const reviewed = skills.filter(skill => skill.reviewedAt).map(skill => ({ value: skill.id as string, label: skill.name as string }))
  const back = '/app/skills'
  const list = rows(skills.map(skill => ({ title: skill.name, meta: `${skill.description} · ${skill.reviewedAt ? 'reviewed' : 'waiting for review'}`,
    aside: !skill.reviewedAt && actor.roles.has('reviewer') && skill.createdBy !== actor.id ? form('skill.review', back, [hidden('skill', skill.id)], 'Mark reviewed', { secondary: true }) : '' })))
  const mappings = h`<h3>Courses</h3>${rows(courses.map(row => ({ title: row.title, meta: `${name.get(row.skill)}${row.objective ? ` · objective: ${row.objective}` : ''}` })))}<h3>Job roles</h3>${rows(roles.map(row => ({ title: row.jobRole, meta: name.get(row.skill) })))}`
  const admin = actor.owner ? h`${card('Propose a skill', form('skill.create', back, [field('Name', 'name'), area('Description', 'description')], 'Propose skill'))}
${card('Map a course', form('skill.course', back, [select('Course', 'course', (await listCourses(env)).map(course => ({ value: course.id, label: course.title }))), checks('Skills it teaches', 'skills', reviewed), field('Objective it serves (optional, exactly as on the course)', 'objective', { required: false })], 'Save course skills'))}
${card('Map a job role', form('skill.role', back, [field('Job role (as in the directory)', 'jobRole'), checks('Skills the role needs', 'skills', reviewed)], 'Save role skills'))}` : ''
  const people = actor.owner || actor.roles.has('manager') ? (await all(env, 'SELECT id, name FROM beam_members ORDER BY name')).filter(person => inScope(actor, person.id)) : []
  const body = h`<h1>Skills</h1><p class="lede">A reviewed skill taxonomy drives suggestions. ${'Only a recorded diagnostic marks a skill met; completing a course never does.'}</p>
<p><a href="/app/skills/${actor.id}">My skills and suggestions</a></p>
${card('Skill taxonomy', skills.length ? list : h`<p>No skills yet.</p>`)}${card('Mappings', mappings)}${admin}
${people.length ? card('People', rows(people.map(person => ({ title: person.name, href: `/app/skills/${person.id}` })))) : ''}`
  return page('Skills', actor, body, { current: back, url })
}

export async function personSkillsPage(env: Bindings, actor: Actor, member: string, url: URL) {
  const [view, taxonomy, paths, zone] = await Promise.all([recommendations(env, actor, member), skillTaxonomy(env), approvedPaths(env, member), business(env).then(value => value?.timezone ?? 'UTC')])
  const self = actor.id === member, back = `/app/skills/${member}`
  const reviewed = taxonomy.skills.filter(skill => skill.reviewedAt).map(skill => ({ value: skill.id as string, label: skill.name as string }))
  const because = (inputs: any[]) => inputs.map(input => input.input === 'role' ? `role ${input.jobRole}` : input.input === 'goal' ? 'declared goal' : `diagnostic ${input.result} (${input.note}, ${input.recordedBy}, ${formatDate(input.recordedAt, zone)})`).join('; ')
  const skills = rows(view.skills.map(skill => ({ title: `${skill.name}${skill.required ? '' : ' (optional goal)'}`, meta: `${STATUS[skill.status]} · because: ${because(skill.because)}${skill.evidence.length ? ` · completed ${skill.evidence.map((item: any) => item.title).join(', ')} (activity, not proof)` : ''}` })))
  const path = view.path.length ? h`${rows(view.path.map(item => ({ title: item.title, meta: item.skills.map((skill: any) => `${skill.name}: ${because(skill.because)}`).join(' · ') })))}${!self || actor.owner ? form('skill.path.approve', back, [hidden('learner', member), hidden('digest', view.digest), field('Due date', 'dueDate', { type: 'date' })], 'Approve this path as required learning') : ''}` : h`<p>Nothing to suggest now.</p>`
  const mine = self ? h`${card('My goals', view.optedOut ? h`<p>You turned optional personalization off: your goals are not used. Required learning stays assigned.</p>` : form('skill.goals', back, [checks('Skills I want to build', 'skills', reviewed, view.goals)], 'Save goals'))}
${card('Personalization', form('skill.personalization', back, [hidden('optedOut', view.optedOut ? 'false' : 'true')], view.optedOut ? 'Turn optional personalization on' : 'Turn optional personalization off', { secondary: true }))}` : ''
  const diagnose = !self && (actor.owner || actor.roles.has('manager')) ? card('Record a diagnostic result', form('skill.diagnostic', back, [hidden('learner', member), select('Skill', 'skill', reviewed), select('Result', 'result', [{ value: 'gap', label: 'Gap' }, { value: 'met', label: 'Met' }]), area('What it was based on', 'note')], 'Record result')) : ''
  const body = h`<h1>${self ? 'My skills and suggestions' : `Skills: ${view.name}`}</h1><p class="lede">${view.note}</p>
${card('Skills', view.skills.length ? skills : h`<p>No role skills or goals yet.</p>`)}${card('Suggested minimal path', path)}${mine}${diagnose}
${paths.length ? card('Approved paths', rows(paths.map(item => ({ title: `${item.courses.length} ${item.courses.length === 1 ? 'course' : 'courses'} approved by ${item.approvedBy}`, meta: formatDate(item.approvedAt, zone) })))) : ''}`
  return page(self ? 'My skills' : `Skills: ${view.name}`, actor, body, { current: '/app/skills', url })
}
