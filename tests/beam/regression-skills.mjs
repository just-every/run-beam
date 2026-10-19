import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'

// LEARN-007: the owner proposes skills that a reviewer reviews, maps a course objective, courses and a job role to them;
// a learner declares a goal, a manager records diagnostic results, and the learner's recommendations explain their
// inputs, never treat a completed course as a met skill and pick the fewest courses. The manager approves that exact
// minimal path as required learning; turning optional personalization off drops the goal but keeps every assignment.
export async function skillsCheck() {
  const f = await fixture()
  try { await skills(f) } finally { await f.h.close() }
}

async function skills(f) {
  const { api, h, ids, cookies } = f
  const titles = view => view.path.map(item => item.title)
  const skill = (view, name) => view.skills.find(row => row.name === name)

  // A skill is proposed by the owner and used only once someone else has reviewed it.
  const temp = (await api('owner', 'skill.create', { name: 'Temperature control', description: 'Keep chilled food at 5 °C or below.' })).id
  const allergen = (await api('owner', 'skill.create', { name: 'Allergen handling', description: 'Prevent cross-contact.' })).id
  const knife = (await api('owner', 'skill.create', { name: 'Knife safety', description: 'Cut, carry and store knives safely.' })).id
  await api('learner', 'skill.create', { name: 'Nope', description: 'x' }, 403)
  await api('owner', 'skill.review', { skill: temp }, 403)
  const cold = await f.course('Cold holding'), hygiene = await f.course('Kitchen hygiene'), allergens = await f.course('Allergen basics'), knives = await f.course('Knife skills')
  assert.equal((await api('owner', 'skill.course', { course: cold.id, skills: [temp] }, 409)).error, 'skill_not_reviewed')
  for (const id of [temp, allergen, knife]) await api('reviewer', 'skill.review', { skill: id })

  // A course objective, courses and a job role are mapped to reviewed skills.
  await api('owner', 'course.catalog', { course: cold.id, objectives: 'Hold chilled food at 5 °C or below' })
  assert.equal((await api('owner', 'skill.course', { course: cold.id, skills: [temp], objective: 'Something else' }, 400)).error, 'objective_not_on_course')
  await api('owner', 'skill.course', { course: cold.id, skills: [temp], objective: 'Hold chilled food at 5 °C or below' })
  await api('owner', 'skill.course', { course: hygiene.id, skills: [temp, allergen] })
  await api('owner', 'skill.course', { course: allergens.id, skills: [allergen] })
  await api('owner', 'skill.course', { course: knives.id, skills: [knife] })
  await api('owner', 'skill.role', { jobRole: 'Line cook', skills: [temp, allergen] })
  await api('owner', 'person.directory', { member: ids.learner, jobRole: 'Line cook' })
  assert.ok((await api('learner', 'skills')).courses.some(row => row.course === cold.id && row.objective === 'Hold chilled food at 5 °C or below'))
  // ORG-007's catalog filters by a mapped reviewed skill as well as by tag.
  await api('owner', 'course.enrollment', { course: knives.id, mode: 'open' })
  const offered = await api('learner', 'catalog?skill=knife+safety')
  assert.deepEqual([offered.courses.map(row => row.id), offered.facets.skills.includes('knife safety')], [[knives.id], true])

  // The learner declares a goal; the role and the goal make three needed skills, covered by two courses.
  await api('learner', 'skill.goals', { skills: [knife] })
  let view = await api('learner', 'skills/me')
  assert.deepEqual(view.skills.map(row => [row.name, row.required, row.status, row.because.map(input => input.input)]), [['Allergen handling', true, 'needed', ['role']], ['Temperature control', true, 'needed', ['role']], ['Knife safety', false, 'needed', ['goal']]])
  assert.deepEqual(titles(view), ['Kitchen hygiene', 'Knife skills'])

  // Completing a mapped course is evidence of activity, never a met skill; that course is not suggested again.
  await f.lessons(await f.assign(cold))
  view = await api('learner', 'skills/me')
  assert.deepEqual([skill(view, 'Temperature control').status, skill(view, 'Temperature control').evidence.map(row => row.title)], ['needed', ['Cold holding']])
  assert.match(view.note, /never proof of a skill/)

  // Only the owner or a manager of the person's team records diagnostics; a met result removes the skill from the path.
  await api('learner', 'skill.diagnostic', { learner: ids.learner, skill: allergen, result: 'met', note: 'x' }, 403)
  await api('manager', 'skill.diagnostic', { learner: ids.learner, skill: temp, result: 'gap', note: 'Probe check missed on the line' })
  await api('manager', 'skill.diagnostic', { learner: ids.learner, skill: allergen, result: 'met', note: 'Observed a clean allergen changeover' })
  view = await api('manager', `skills/${ids.learner}`)
  assert.equal(skill(view, 'Allergen handling').status, 'met')
  assert.deepEqual(skill(view, 'Temperature control').because.map(input => [input.input, input.result ?? null, input.note ?? null]), [['role', null, null], ['diagnostic', 'gap', 'Probe check missed on the line']])
  assert.deepEqual(titles(view), ['Kitchen hygiene', 'Knife skills'])
  assert.deepEqual(view.path[0].skills.map(row => row.name), ['Temperature control'])
  await api('author', `skills/${ids.learner}`, undefined, 404)

  // The manager approves that exact path; the learner cannot approve their own, and a changed recommendation is refused.
  const due = { dueDate: '2030-06-01', dueTime: '17:00', timezone: 'UTC' }
  await api('learner', 'skill.path.approve', { learner: ids.learner, digest: view.digest, ...due }, 403)
  await api('manager', 'skill.path.approve', { learner: ids.learner, digest: '0'.repeat(64), ...due }, 409)
  assert.equal((await h.submit('skill.path.approve', cookies.manager, { learner: ids.learner, digest: view.digest, ...due }, `/app/skills/${ids.learner}`)).searchParams.get('error'), null)
  const open = async () => (await api('learner', 'records/me')).assignments.filter(row => row.status === 'open').map(row => row.course).sort()
  assert.deepEqual(await open(), [hygiene.id, knives.id].sort())
  view = await api('learner', 'skills/me')
  assert.deepEqual([titles(view), skill(view, 'Temperature control').status, skill(view, 'Knife safety').status], [[], 'assigned', 'assigned'])

  // Turning optional personalization off drops the goal from the recommendations; required learning stays.
  await api('learner', 'skill.personalization', { optedOut: 'true' })
  view = await api('learner', 'skills/me')
  assert.deepEqual([view.optedOut, view.goals, view.skills.map(row => row.name)], [true, [], ['Allergen handling', 'Temperature control']])
  assert.deepEqual(await open(), [hygiene.id, knives.id].sort())
  for (const [cookie, path] of [[cookies.learner, `/app/skills/${ids.learner}`], [cookies.manager, `/app/skills/${ids.learner}`], [cookies.owner, '/app/skills']]) assert.equal((await h.raw(path, { cookie })).status, 200, path)
}
