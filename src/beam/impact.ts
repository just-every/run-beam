// AGENT-004: what one procedure change invalidates in one course. Beam compares the two immutable source versions of
// a source-change notice line by line and matches every changed passage against the course draft's lessons that cite
// the source, its quiz questions (prompt versus answer), its practical instructions, cited package/xAPI metadata and the
// practice scenarios of its published revision; everything else is listed as untouched. Affected job roles come from LEARN-007 role mappings
// and from the roles of people holding a completion of an earlier revision, with counts and renewal dates, never names.
// The impact proposal is deterministic, never simulated model output: it rewrites only lesson lines that quote a
// changed source line exactly, re-cites the new version on those lessons, and lists everything else for a person.
// Retraining the named reviewer requires is assigned when the next revision publishes, to active people in the chosen
// roles who hold a completion of an earlier revision; earlier completions are never touched.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, insist, now, one, stmt, type Row } from './core'
import { insertAssignments } from './assignments'
import { loadCourse, type Draft } from './courses'
import { diffLines } from './diff'
import { sourceText } from './history'
import type { Input } from './input'
import { createProposal } from './maintenance'
import { requireBusiness } from './people'
import type { PackageManifest } from './packages/types'
import { kindOf, type Question } from './question-types'
import { localDate } from './time'
import { requireCourseRole } from './units'

export const IMPACT_AGENT = 'beam-impact-rule'
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'you', 'are', 'was', 'were', 'into', 'then', 'when', 'each', 'any', 'all', 'not', 'but', 'its', 'our'])

/** Lower-cased runs of letters and digits (two or more letters, or any number), without common joining words. */
const words = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => (word.length >= 2 || /\p{N}/u.test(word)) && !STOP.has(word)))

export interface Change { removed: string[]; added: string[] }
interface Key { line: string; words: Set<string> }

/** Consecutive removed and added lines form one changed passage; blank lines are ignored. */
function changes(before: string, after: string): Change[] | null {
  const diff = diffLines(before, after)
  if ('tooLarge' in diff) return null
  const out: Change[] = []
  let current: Change | null = null
  for (const line of diff.lines) {
    if (line.op === 'same') { if (line.text.trim()) current = null; continue }
    if (!line.text.trim()) continue
    if (!current) out.push(current = { removed: [], added: [] })
    ;(line.op === 'del' ? current.removed : current.added).push(line.text.trim())
  }
  return out
}

/** A removed line's key: its words absent from the passage's added lines, or all its words when a step was only extended. */
function keys(passages: Change[]): Key[] {
  return passages.flatMap(change => {
    const added = words(change.added.join(' '))
    return change.removed.map(line => {
      const own = words(line), distinct = new Set([...own].filter(word => !added.has(word)))
      return { line, words: distinct.size ? distinct : own }
    })
  }).filter(key => key.words.size)
}

/** A text is affected when it holds at least half (rounded up) of some removed line's key words. */
function hits(text: string, changed: Key[]) {
  const have = words(text)
  return changed.filter(key => [...key.words].filter(word => have.has(word)).length >= Math.ceil(key.words.size / 2)).map(key => key.line)
}

function questionParts(question: Question): { prompt: string; answer: string[] } {
  const kind = kindOf(question) as string, q = question as any
  if (kind === 'blank') return { prompt: q.prompt, answer: q.blanks.flat() }
  if (kind === 'order') return { prompt: q.prompt, answer: q.items }
  if (kind === 'match') return { prompt: q.prompt, answer: q.pairs.map((pair: { left: string; right: string }) => `${pair.left} ${pair.right}`) }
  if (kind === 'text') return { prompt: q.prompt, answer: q.guidance ? [q.guidance] : [] }
  return { prompt: `${q.prompt}\n${q.choices.filter((_: string, index: number) => !q.correct.includes(index)).join('\n')}`, answer: q.correct.map((index: number) => q.choices[index]) }
}

async function loadNotice(env: Bindings, actor: Actor, id: string) {
  const notice = await one(env, `SELECT n.*, c.reviewer_id, s.title AS source_title FROM beam_source_notices n JOIN beam_courses c ON c.id = n.course_id
    JOIN beam_sources s ON s.id = n.source_id WHERE n.id = ?`, id)
  insist(notice, 'notice_not_found', 404)
  // The owner, the course's authors and its named reviewer read the impact.
  if (!(actor.roles.has('reviewer') && notice.reviewer_id === actor.id)) await requireCourseRole(env, actor, notice.course_id, 'author')
  return notice
}

async function analyse(env: Bindings, notice: Row) {
  const [from, to] = await Promise.all([notice.previous_version_id, notice.new_version_id].map(id => one(env, 'SELECT * FROM beam_source_versions WHERE id = ?', id)))
  const [before, after] = await Promise.all([sourceText(env, from!), sourceText(env, to!)])
  const passages = before !== null && after !== null ? changes(before, after) : null
  const course = await loadCourse(env, notice.course_id)
  const versions = new Set((await all<{ id: string }>(env, 'SELECT id FROM beam_source_versions WHERE source_id = ?', notice.source_id)).map(row => row.id))
  const changed = keys(passages ?? [])
  const lessons = course.draft.lessons.map(lesson => {
    const cites = lesson.sources.some(version => versions.has(version))
    const lines = cites ? lesson.body.split('\n').map(line => ({ line, changes: hits(line, changed) })).filter(row => row.changes.length) : []
    return { id: lesson.id, title: lesson.title, cites, affected: cites && (passages === null || lines.length > 0), passages: lines.map(row => ({ text: row.line.trim(), changes: row.changes })) }
  })
  // Only each item's own citations qualify its metadata. Immutable packages and activities are never rewritten.
  const [packageRows, xapiRows] = await Promise.all([
    all(env, `SELECT p.* FROM beam_packages p WHERE p.course_id = ? AND
      (p.id IN (SELECT value FROM json_each(?)) OR p.id IN
        (SELECT package_id FROM beam_revision_packages WHERE course_revision_id = ?)) ORDER BY p.created_at, p.id`,
    course.id, JSON.stringify(course.draft.packages ?? []), course.published_revision_id),
    all(env, `SELECT id, title, objectives, activity_iri, launch_url, source_version_ids
      FROM beam_xapi_activities WHERE course_id = ? AND
      (id IN (SELECT value FROM json_each(?)) OR id IN
        (SELECT activity_id FROM beam_revision_xapi WHERE course_revision_id = ?)) ORDER BY created_at, id`,
    course.id, JSON.stringify(course.draft.xapiActivities ?? []), course.published_revision_id),
  ])
  const packageMetadata = packageRows.map(row => {
    const manifest = JSON.parse(row.manifest_json) as PackageManifest
    const cites = (JSON.parse(row.source_version_ids) as string[]).some(version => versions.has(version))
    const metadata = [
      { field: 'title', text: row.title as string },
      { field: 'manifest title', text: manifest.title },
      ...manifest.objectives.map(text => ({ field: 'objective', text })),
      ...manifest.scos.flatMap(sco => [
        { field: `SCO ${sco.id} title`, text: sco.title },
        { field: `SCO ${sco.id} launch`, text: sco.launch },
        ...sco.objectives.map(text => ({ field: `SCO ${sco.id} objective`, text })),
        ...(sco.dataFromLMS ? [{ field: `SCO ${sco.id} dataFromLMS`, text: sco.dataFromLMS }] : []),
      ]),
    ]
    const found = cites ? metadata.flatMap(item => item.text.split('\n').map(text => ({ field: item.field, text, changes: hits(text, changed) }))).filter(item => item.changes.length) : []
    return { id: row.id as string, type: 'scorm' as const, title: row.title as string, cites, affected: cites && (passages === null || found.length > 0), passages: found }
  })
  const xapiMetadata = xapiRows.map(row => {
    const cites = (JSON.parse(row.source_version_ids) as string[]).some(version => versions.has(version))
    const metadata = ['title', 'objectives', 'activity_iri', 'launch_url'].map(field => ({ field, text: row[field] as string }))
    const found = cites ? metadata.flatMap(item => item.text.split('\n').map(text => ({ field: item.field, text, changes: hits(text, changed) }))).filter(item => item.changes.length) : []
    return { id: row.id as string, type: 'xapi' as const, title: row.title as string, cites, affected: cites && (passages === null || found.length > 0), passages: found }
  })
  const packages = [...packageMetadata, ...xapiMetadata]
  const cited = lessons.some(lesson => lesson.cites)
  const questions = course.draft.questions.map(question => {
    const parts = questionParts(question), answer = parts.answer.flatMap(text => hits(text, changed)), prompt = hits(parts.prompt, changed)
    const affected = cited && (passages === null || answer.length + prompt.length > 0)
    return { id: question.id, prompt: question.prompt, affected, part: !affected ? null : passages === null ? 'unknown' : answer.length ? 'answer' : 'prompt', changes: [...new Set([...answer, ...prompt])] }
  })
  const practical = course.draft.practical ? { affected: cited && (passages === null || hits(course.draft.practical.instructions, changed).length > 0), changes: hits(course.draft.practical.instructions, changed) } : null
  const scenarios = (course.published_revision_id ? await all(env, 'SELECT id, title, rubric, steps_json FROM beam_scenarios WHERE course_revision_id = ? ORDER BY approved_at', course.published_revision_id) : []).map(scenario => {
    const steps = JSON.parse(scenario.steps_json) as { situation: string; choices: { label: string; feedback: string }[] }[]
    const text = [scenario.rubric, ...steps.flatMap(step => [step.situation, ...step.choices.flatMap(choice => [choice.label, choice.feedback])])].join('\n')
    const found = hits(text, changed)
    return { id: scenario.id, title: scenario.title, affected: cited && (passages === null || found.length > 0), changes: found }
  })
  return { notice, course, from: from!, to: to!, versions, passages, lessons, packages, questions, practical, scenarios, roles: await affectedRoles(env, course.id) }
}

/** Job roles the course teaches for (LEARN-007 mappings) or whose holders completed an earlier revision: counts and renewal dates only. */
async function affectedRoles(env: Bindings, course: string) {
  const zone = (await requireBusiness(env)).timezone
  const mapped = new Set((await all<{ role: string }>(env, 'SELECT DISTINCT lower(r.job_role) AS role FROM beam_role_skills r JOIN beam_course_skills c ON c.skill_id = r.skill_id WHERE c.course_id = ?', course)).map(row => row.role))
  const people = await all<{ id: string; role: string | null; completed: number | null; expires: number | null }>(env, `SELECT m.id, lower(m.job_role) AS role,
      (SELECT MAX(c.completed_at) FROM beam_completions c WHERE c.learner_id = m.id AND c.course_id = ?) AS completed,
      (SELECT c.expires_at FROM beam_completions c WHERE c.learner_id = m.id AND c.course_id = ? ORDER BY c.completed_at DESC LIMIT 1) AS expires
    FROM beam_members m JOIN oa_operators o ON o.id = m.operator_id WHERE o.status = 'active' AND m.employment <> 'terminated'`, course, course)
  const roles = new Set([...mapped, ...people.filter(person => person.completed !== null && person.role).map(person => person.role!)])
  return [...roles].sort().map(role => {
    const holders = people.filter(person => person.role === role), completed = holders.filter(person => person.completed !== null)
    const renewals = new Map<string, number>()
    for (const person of completed) if (person.expires !== null) { const day = localDate(person.expires, zone); renewals.set(day, (renewals.get(day) ?? 0) + 1) }
    return { jobRole: role, mapped: mapped.has(role), people: holders.length, completed: completed.length, withoutRenewal: completed.filter(person => person.expires === null).length, renewals: [...renewals].sort().map(([on, count]) => ({ on, count })) }
  })
}

/** The impact of one source-change notice on its course, with what is untouched. */
export async function noticeImpact(env: Bindings, actor: Actor, id: string) {
  const { notice, course, from, to, passages, lessons, packages, questions, practical, scenarios, roles } = await analyse(env, await loadNotice(env, actor, id))
  return {
    notice: notice.id, course: course.id, state: notice.state, source: notice.source_id, sourceTitle: notice.source_title,
    from: { id: from.id, number: from.number }, to: { id: to.id, number: to.number }, draftVersion: course.draft_version,
    compared: passages !== null,
    compareNote: passages === null ? 'These versions could not be compared line by line (only text files up to 1 MB are); every item citing the source is listed as affected for a person to read.' : null,
    changes: passages ?? [],
    lessons: { affected: lessons.filter(lesson => lesson.affected), untouched: lessons.filter(lesson => !lesson.affected).map(({ id, title, cites }) => ({ id, title, cites })) },
    questions: { affected: questions.filter(question => question.affected), untouched: questions.filter(question => !question.affected).map(({ id, prompt }) => ({ id, prompt })) },
    practical, scenarios,
    packages,
    roles,
    retraining: notice.retraining ? { decision: notice.retraining, roles: JSON.parse(notice.retrain_roles ?? '[]') as string[], dueOn: notice.retrain_due_on ?? null, assignedWith: notice.retrain_revision_id ?? null } : null,
  }
}

/** Beam's own impact proposal against the current draft: only exact quotes of a changed line are rewritten. */
export async function proposeImpact(env: Bindings, actor: Actor, input: Input) {
  const notice = await loadNotice(env, actor, input.text('notice'))
  await requireCourseRole(env, actor, notice.course_id, 'author')
  insist(notice.state === 'open', 'notice_decided', 409)
  const latest = await one<{ id: string }>(env, 'SELECT id FROM beam_source_versions WHERE source_id = ? ORDER BY number DESC LIMIT 1', notice.source_id)
  insist(latest?.id === notice.new_version_id, 'source_superseded', 409)
  const { course, to, versions, passages, lessons, packages, questions, practical, scenarios } = await analyse(env, notice)
  const draftVersion = input.integer('draftVersion', { min: 1, max: 1_000_000 })!
  insist(draftVersion === course.draft_version, 'stale_draft', 409, { draftVersion: course.draft_version })
  const draft: Draft = structuredClone(course.draft)
  const quoted = new Map<string, string>()
  for (const change of passages ?? []) if (change.removed.length === change.added.length) change.removed.forEach((line, index) => quoted.set(line, change.added[index]))
  const used: { sourceVersion: string; quote: string; lesson: string }[] = [], missing: string[] = []
  for (const item of packages.filter(item => item.affected)) missing.push(item.type === 'xapi'
    ? `xAPI activity “${item.title}”: a person prepares replacement metadata; this immutable activity is unchanged. Check ${passages === null ? 'the cited source; text comparison unavailable' : [...new Set(item.passages.map(passage => passage.field))].join(', ')}.`
    : `Package “${item.title}”: a person updates metadata in the original and uploads a replacement; this immutable package is unchanged. Check ${passages === null ? 'the cited source; text comparison unavailable' : [...new Set(item.passages.map(passage => passage.field))].join(', ')}.`)
  for (const found of lessons.filter(lesson => lesson.affected)) {
    const lesson = draft.lessons.find(item => item.id === found.id)!
    const manual = found.passages.filter(passage => !quoted.has(passage.text))
    if (passages === null || manual.length || !found.passages.length) {
      missing.push(passages === null ? `“${lesson.title}” cites a source that could not be compared as text: a person reads both versions.` : `“${lesson.title}” teaches a changed step in its own words: a person rewrites ${manual.map(passage => `“${passage.text}”`).join(', ')}.`)
      continue
    }
    lesson.body = lesson.body.split('\n').map(line => quoted.has(line.trim()) ? line.replace(line.trim(), quoted.get(line.trim())!) : line).join('\n')
    lesson.sources = [...new Set(lesson.sources.map(version => versions.has(version) ? notice.new_version_id : version))]
    for (const passage of found.passages) used.push({ sourceVersion: notice.new_version_id, quote: quoted.get(passage.text)!, lesson: lesson.title })
  }
  for (const question of questions.filter(item => item.affected)) missing.push(`Question “${question.prompt}”: its ${question.part === 'answer' ? 'answer' : question.part === 'prompt' ? 'wording' : 'content'} depends on a changed step: a person revises it.`)
  if (practical?.affected) missing.push('The practical assessment instructions describe a changed step: a person revises them.')
  for (const scenario of scenarios.filter(item => item.affected)) missing.push(`Practice scenario “${scenario.title}” uses a changed step: its rubric needs a new scenario for the next revision.`)
  for (const change of passages ?? []) if (!change.removed.length) missing.push(`New in version ${to.number}: ${change.added.map(line => `“${line}”`).join(', ')}; no lesson teaches it yet.`)
  const rewritten = used.length
  const summary = 'Prepared by rule, not by a model. ' + (rewritten ? `Updates ${rewritten} quoted ${rewritten === 1 ? 'line' : 'lines'} in ${new Set(used.map(item => item.lesson)).size} ${new Set(used.map(item => item.lesson)).size === 1 ? 'lesson' : 'lessons'} to “${notice.source_title}” version ${to.number}; everything else is unchanged.` : `No line quotes the changed source exactly, so nothing was rewritten; the list below is for a person.`)
  const created = await createProposal(env, actor, { course: course.id, draftVersion, inputs: [notice.new_version_id], draft, agent: IMPACT_AGENT, summary, passages: used, missing: missing.slice(0, 20).map(item => item.slice(0, 300)) }, { notice: notice.id })
  return { ...created, rewritten, missing }
}


/** On publication: assigns the new revision to the people each required retraining names (assigned by its decider). */
export async function retrainAfterPublish(env: Bindings, actor: Actor, course: string, revision: string) {
  const notices = await all(env, "SELECT id, decided_by, retrain_roles, retrain_due_on FROM beam_source_notices WHERE course_id = ? AND retraining = 'required' AND retrain_revision_id IS NULL", course)
  const timezone = (await requireBusiness(env)).timezone
  let created = 0
  for (const notice of notices) {
    const people = await all<{ id: string }>(env, `SELECT DISTINCT m.id FROM beam_members m JOIN oa_operators o ON o.id = m.operator_id JOIN json_each(?) r ON r.value = lower(m.job_role)
      WHERE o.status = 'active' AND m.employment <> 'terminated' AND EXISTS (SELECT 1 FROM beam_completions c WHERE c.learner_id = m.id AND c.course_id = ? AND c.course_revision_id <> ?) ORDER BY m.id`, notice.retrain_roles, course, revision)
    const result = await insertAssignments(env, { ...actor, id: notice.decided_by }, people.map(person => ({ learner: person.id, course, dueDate: notice.retrain_due_on, dueTime: '17:00', timezone, reason: 'retraining' })), 'assignment.retraining')
    await env.DB.batch([stmt(env, 'UPDATE beam_source_notices SET retrain_revision_id = ? WHERE id = ?', revision, notice.id), stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) VALUES (?, ?, ?, ?, ?)', now(), notice.decided_by, 'notice.retraining', notice.id, JSON.stringify({ revision, created: result.created, kept: result.kept }))])
    created += result.created.length
  }
  return created
}
