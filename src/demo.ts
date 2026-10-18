// Demo data for `rer demo` and the hosted demo (modules/demo runs it once, after
// the owner exists): Sierra Lakes Produce (src/demo-records.ts), 131 people at
// three US sites. The followed staff carry the detail: overdue courses, a
// practical waiting for its assessor (one for the owner), a learner out of quiz
// attempts, a prerequisite still open, renewals coming due, a revision and a
// procedure change to review, and the agent's work (two plans waiting, one
// approved, one declined). The rest of the crew's history comes from attested
// classroom sessions. Fixed ids with INSERT OR IGNORE keep it idempotent; every
// date follows `now`. It never fetches.
import type { Bindings } from './auth.server'
import { payloadDigest } from './beam/agent-work'
import { sha256Hex } from './beam/core'
import { DAY, localDate, zonedInstant } from './beam/time'
import { AGENT, BUSINESS, COURSES, CREW, crewAt, emailOf, nameOf, OWNER_NAME, PATHS, SESSIONS, SITES, siteOf, SOURCES, STAFF, ZONE, type CourseKey, type LessonData, type Named, type Person, type SessionKey, type Site } from './demo-records'

// UUID-shaped ids; the first segment varies, so certificate numbers do too.
const id = (kind: string, n: number) => `${kind}${String(n).padStart(6, '0')}-5eed-4b3a-8d3e-0000000000de`

// The followed staff's training, one record each: due (days from now), assigned, and what the learner has done.
interface AssignmentData {
  n: number; learner: Person; course: CourseKey; due: number; assigned: number; path?: Site
  lessonsDone?: number; quiz?: { at: number; answers: number[][] }[]; practical?: { at: number; evidence: string; decided?: { at: number; note: string } }
  completed?: { at: number; method: 'assessed' | 'lessons' | 'offline'; session?: SessionKey }
}
const right = (course: CourseKey) => COURSES.find(item => item.key === course)!.questions!.map(question => question.correct)
const ASSIGNMENTS: AssignmentData[] = [
  { n: 1, learner: 'tomas', course: 'ammonia', due: -3, assigned: -17, path: 'fresno', lessonsDone: 1 },
  { n: 2, learner: 'rafael', course: 'ammonia', due: 12, assigned: -2, path: 'fresno' },
  { n: 3, learner: 'rafael', course: 'cold', due: 12, assigned: -2, path: 'fresno' },
  { n: 4, learner: 'rafael', course: 'lift', due: 19, assigned: -2, path: 'fresno' },
  { n: 5, learner: 'ines', course: 'lift', due: -4, assigned: -30, path: 'fresno', lessonsDone: 3, quiz: [{ at: -6, answers: right('lift') }],
    practical: { at: -5, evidence: 'Pre-shift inspection signed at 6:10 a.m., then two pallets from dock 4 to rack row C. Maria could not watch that shift, so Nadia Flores observed and signed the sheet.' } },
  { n: 6, learner: 'miguel', course: 'cold', due: -2, assigned: -16, path: 'fresno', lessonsDone: 1 },
  { n: 7, learner: 'tyrone', course: 'lift', due: -7, assigned: -28, path: 'joliet', lessonsDone: 2 },
  { n: 8, learner: 'hannah', course: 'security', due: -3, assigned: -17, path: 'chicago' },
  { n: 9, learner: 'samp', course: 'dock', due: 3, assigned: -10, path: 'joliet', lessonsDone: 3, quiz: [{ at: -4, answers: [[1], [0]] }, { at: -2, answers: [[0], [2]] }] },
  { n: 10, learner: 'rosa', course: 'cold', due: 4, assigned: -10, path: 'fresno', lessonsDone: 2, quiz: [{ at: -2, answers: right('cold') }],
    practical: { at: -1, evidence: 'PPE check at the cooler 2 anteroom with Ines: jacket, hood, gloves and lined boots on, checked each other, then logged entry at 6:42 a.m.' } },
  { n: 11, learner: 'juan', course: 'lift', due: -1069, assigned: -1090, path: 'fresno', completed: { at: -1076, method: 'offline', session: 6 } },
  { n: 12, learner: 'owner', course: 'ammonia', due: -33, assigned: -47, path: 'fresno', lessonsDone: 3, quiz: [{ at: -40, answers: right('ammonia') }], completed: { at: -40, method: 'assessed' } },
  { n: 13, learner: 'owner', course: 'harassment', due: 20, assigned: -5, lessonsDone: 1 },
  { n: 14, learner: 'nadia', course: 'lift', due: -55, assigned: -75, path: 'fresno', lessonsDone: 3, quiz: [{ at: -62, answers: right('lift') }],
    practical: { at: -61, evidence: 'Inspection and three pallet moves on the night shift, with Maria watching from the dock 4 office.', decided: { at: -60, note: 'Clean inspection; slowed and sounded the horn at every rack end.' } }, completed: { at: -60, method: 'assessed' } },
  { n: 15, learner: 'keisha', course: 'dock', due: -24, assigned: -38, path: 'joliet', lessonsDone: 3, quiz: [{ at: -30, answers: right('dock') }], completed: { at: -30, method: 'assessed' } },
  { n: 16, learner: 'lena', course: 'security', due: -14, assigned: -28, path: 'chicago', lessonsDone: 2, quiz: [{ at: -20, answers: right('security') }], completed: { at: -20, method: 'assessed' } },
  { n: 17, learner: 'pat', course: 'security', due: 9, assigned: -5, path: 'chicago', lessonsDone: 1 },
  { n: 18, learner: 'maria', course: 'ammonia', due: -93, assigned: -107, path: 'fresno', lessonsDone: 3, quiz: [{ at: -100, answers: right('ammonia') }], completed: { at: -100, method: 'assessed' } },
]
const followed = (course: CourseKey) => new Set(ASSIGNMENTS.filter(row => row.course === course).map(row => row.learner))

// The crew's records: completions from attested sessions, and assignments still open.
type Bulk = { learner: Person; course: CourseKey; session?: SessionKey; due?: number }
function crewRecords(): Bulk[] {
  const fresno = ['owner', ...Object.keys(STAFF).filter(key => STAFF[key as Named].site === 'fresno'), ...crewAt('fresno')] as Person[]
  const fresnoCrew = crewAt('fresno'), joliet = crewAt('joliet'), chicago = crewAt('chicago')
  const others = (course: CourseKey, people: Person[]) => people.filter(person => person !== 'owner' && !followed(course).has(person))
  const ammonia = others('ammonia', fresno)
  const harassment = others('harassment', fresno)
  return [
    ...ammonia.map((learner, index) => ({ learner, course: 'ammonia' as const, session: (index < 2 ? 2 : 1) as SessionKey })),
    ...fresnoCrew.slice(0, 27).map(learner => ({ learner, course: 'cold' as const, session: 3 as SessionKey })),
    ...fresnoCrew.slice(27, 60).map(learner => ({ learner, course: 'lift' as const, session: 4 as SessionKey })),
    ...fresnoCrew.slice(60, 63).map(learner => ({ learner, course: 'lift' as const, session: 6 as SessionKey })),
    ...(['keisha', ...joliet.slice(0, 23)] as Person[]).map(learner => ({ learner, course: 'lift' as const, session: 5 as SessionKey })),
    ...harassment.slice(0, 47).map(learner => ({ learner, course: 'harassment' as const, session: 7 as SessionKey })),
    ...harassment.slice(47).map(learner => ({ learner, course: 'harassment' as const, due: 183 })),
    ...chicago.map(learner => ({ learner, course: 'security' as const, session: 8 as SessionKey })),
    ...joliet.slice(0, 30).map(learner => ({ learner, course: 'dock' as const, session: 9 as SessionKey })),
    ...joliet.slice(30, 36).map(learner => ({ learner, course: 'dock' as const, due: 5 })),
  ]
}

// D1 binds at most 100 values per statement: rows of one table go in as few multi-row inserts as that allows.
function inserts(db: D1Database, head: string, rows: unknown[][]): D1PreparedStatement[] {
  if (!rows.length) return []
  const width = rows[0].length, per = Math.floor(100 / width), out: D1PreparedStatement[] = []
  for (let start = 0; start < rows.length; start += per) {
    const chunk = rows.slice(start, start + per)
    out.push(db.prepare(`${head} VALUES ${chunk.map(() => `(${Array(width).fill('?').join(', ')})`).join(', ')}`).bind(...chunk.flat()))
  }
  return out
}

export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }): Promise<void> {
  const db = env.DB, at = (days: number, hours = 0) => now.getTime() + days * DAY + hours * 3_600_000
  const q = (sql: string, ...values: unknown[]) => db.prepare(sql).bind(...values)
  // A wall-clock time on a day in the business zone, never later than now.
  const clock = (days: number, time: string) => { const instant = zonedInstant(localDate(at(days), ZONE), time, ZONE); return instant > now.getTime() ? instant - DAY : instant }
  const owner = await db.prepare("SELECT id, display_name FROM oa_operators WHERE email = ? AND role = 'owner'").bind(ownerEmail).first<{ id: string; display_name: string }>()
  if (!owner) return
  // The owner's Beam membership may already exist from a first page view; keep its id.
  // A demo owner arrives with a placeholder name; the business's lead has her own.
  const generic = (name: string | null) => !name || name.trim().toLowerCase() === 'owner'
  const ownerName = generic(owner.display_name) ? OWNER_NAME : owner.display_name
  await q('INSERT INTO beam_members (id, email, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING', id('a0', 0), ownerEmail, ownerName, at(-900)).run()
  await q("UPDATE beam_members SET name = ? WHERE email = ? AND (name = '' OR lower(name) = 'owner')", ownerName, ownerEmail).run()
  if (generic(owner.display_name)) await q('UPDATE oa_operators SET display_name = ? WHERE id = ?', ownerName, owner.id).run()
  const ownerMember = (await q('SELECT id FROM beam_members WHERE email = ?', ownerEmail).first<{ id: string }>())!.id
  const staffKeys = Object.keys(STAFF) as Named[]
  const member = (person: Person) => person === 'owner' ? ownerMember : person.startsWith('crew') ? id('a3', Number(person.slice(4))) : id('a0', staffKeys.indexOf(person as Named) + 1)
  const zoneOf = (person: Person) => SITES[siteOf(person)].zone
  const due = (days: number, zone: string) => { const date = localDate(at(days), zone); return { date, at: zonedInstant(date, '17:00', zone) } }

  const statements: D1PreparedStatement[] = [
    q('INSERT INTO oa_first_run (singleton, completed_by, completed_at) VALUES (1, ?, ?) ON CONFLICT(singleton) DO NOTHING', owner.id, at(-900)),
    q('INSERT OR IGNORE INTO beam_business (singleton, name, timezone, updated_at) VALUES (1, ?, ?, ?)', BUSINESS, ZONE, at(-900)),
    ...['author', 'reviewer', 'learner', 'manager', 'assessor'].map(role => q('INSERT OR IGNORE INTO beam_member_roles (member_id, role) VALUES (?, ?)', ownerMember, role)),
  ]
  // Everyone has a sign-in account and a Beam membership; Derek's access was removed when he left.
  const people = [...staffKeys.map((key, index) => ({ person: key as Person, operator: id('a1', index + 1), roles: [...STAFF[key].roles] as string[], former: 'former' in STAFF[key] })),
    ...CREW.map((person, index) => ({ person: person.key as Person, operator: id('a4', index + 1), roles: ['learner'], former: false }))]
  const joined = (index: number) => at(-880 + (index % 40) * 20)
  statements.push(
    ...inserts(db, 'INSERT OR IGNORE INTO oa_operators (id, email, display_name, role, status, created_at)', people.map((row, index) => [row.operator, emailOf(row.person as Exclude<Person, 'owner'>), nameOf(row.person as Exclude<Person, 'owner'>), 'member', row.former ? 'inactive' : 'active', joined(index)])),
    ...inserts(db, 'INSERT OR IGNORE INTO beam_members (id, email, name, created_at)', people.map((row, index) => [member(row.person), emailOf(row.person as Exclude<Person, 'owner'>), nameOf(row.person as Exclude<Person, 'owner'>), joined(index)])),
    ...inserts(db, 'INSERT OR IGNORE INTO beam_member_roles (member_id, role)', people.flatMap(row => row.roles.map(role => [member(row.person), role]))),
  )
  const sites = Object.keys(SITES) as Site[]
  const team = (site: Site) => id('a2', sites.indexOf(site) + 1)
  sites.forEach(site => statements.push(q('INSERT OR IGNORE INTO beam_teams (id, name, created_at) VALUES (?, ?, ?)', team(site), SITES[site].team, at(-890))))
  statements.push(...inserts(db, 'INSERT OR IGNORE INTO beam_team_members (team_id, member_id)', [['owner' as Person], ...people.filter(row => !row.former).map(row => [row.person])].map(([person]) => [team(siteOf(person)), member(person)])))

  // Owned sources: bytes in FILES by content hash, as sources.ts stores them. A put of the same
  // bytes to their content key is idempotent, so the objects are written together, without a head.
  const reviewerOf = (key: string): Person => key === 'dock' ? 'keisha' : key === 'harassment' ? 'carmen' : 'nadia'
  const versions = new Map<string, string[]>(), objects = new Map<string, Uint8Array>()
  let versionNumber = 0
  for (const [index, source] of SOURCES.entries()) {
    const sourceId = id('b0', index + 1)
    statements.push(q('INSERT OR IGNORE INTO beam_sources (id, title, licence, licence_evidence, reviewer_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', sourceId, source.title, source.licence, source.evidence, member(reviewerOf(source.key)), member(source.author), at(source.versions[0].at)))
    const ids: string[] = []
    for (const [number, version] of source.versions.entries()) {
      const bytes = new TextEncoder().encode(version.text), sha256 = await sha256Hex(bytes), versionId = id('b1', ++versionNumber)
      objects.set(sha256, bytes)
      statements.push(q("INSERT OR IGNORE INTO beam_source_versions (id, source_id, number, filename, media_type, size, sha256, provenance, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, 'text/plain', ?, ?, ?, ?, ?)", versionId, sourceId, number + 1, version.file, bytes.length, sha256, version.provenance, member(source.author), at(version.at)))
      ids.push(versionId)
    }
    versions.set(source.key, ids)
  }
  await Promise.all([...objects].map(([sha256, bytes]) => env.FILES.put(`sha256/${sha256}`, bytes, { httpMetadata: { contentType: 'application/octet-stream' } })))
  // Courses cite each source's first version; DP-7's newer version raises a notice.
  const cite = (lesson: LessonData) => (lesson.sources ?? []).map(key => versions.get(key)![0])

  const courseId = (key: CourseKey) => id('c0', COURSES.findIndex(course => course.key === key) + 1)
  const course = (key: CourseKey) => COURSES.find(item => item.key === key)!
  const published = new Map<CourseKey, { revision: string; number: number; lessons: string[]; assessment: string | null; questions: { id: string; correct: number[] }[] }>()
  let revisionCount = 0, lessonCount = 0
  for (const [index, data] of COURSES.entries()) {
    const key = data.key, cid = courseId(key)
    const draftLessons = data.lessons.map((lesson, position) => ({ id: id('c1', index * 10 + position + 1), title: lesson.title, body: lesson.body, sources: cite(lesson) }))
    const questions = (data.questions ?? []).map((question, position) => ({ id: id('c2', index * 10 + position + 1), prompt: question.prompt, choices: question.choices, correct: question.correct }))
    const assessed = questions.length > 0 || !!data.practical
    const draft = { title: data.title, summary: data.summary, lessons: draftLessons, questions, passPercent: data.passPercent ?? null, maxAttempts: data.maxAttempts ?? null, practical: data.practical ? { instructions: data.practical, assessor: member(data.assessor ?? 'maria') } : null }
    const draftVersion = 3 + data.lessons.length * 2 + questions.length + data.revisions.length * 2
    const current = [...data.revisions.keys()].reverse().find(position => data.revisions[position].state === 'published')
    statements.push(q('INSERT OR IGNORE INTO beam_courses (id, title, reviewer_id, created_by, created_at, draft_json, draft_version, published_revision_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', cid, data.title, member(data.reviewer), member(data.author), at(data.createdAt), JSON.stringify(draft), draftVersion, current === undefined ? null : id('c3', revisionCount + current + 1)))
    for (const [number, revision] of data.revisions.entries()) {
      const rid = id('c3', ++revisionCount), lessons = draftLessons.slice(0, revision.lessons ?? draftLessons.length)
      const reviewed = revision.state === 'in_review' ? [null, null] : [member(data.reviewer), at(revision.at, 4)]
      statements.push(q('INSERT OR IGNORE INTO beam_course_revisions (id, course_id, number, title, summary, draft_version, state, submitted_by, submitted_at, reviewed_by, reviewed_at, review_note, reassignment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        rid, cid, number + 1, data.title, data.summary, draftVersion - (data.revisions.length - number) * 2, revision.state, member(data.author), at(revision.at), ...reviewed, revision.note ?? null, revision.state === 'published' || revision.state === 'superseded' ? 'none' : null))
      const lessonIds = lessons.map((lesson, position) => {
        const lid = id('c4', ++lessonCount)
        statements.push(q('INSERT OR IGNORE INTO beam_lesson_revisions (id, course_revision_id, position, title, body, source_version_ids) VALUES (?, ?, ?, ?, ?, ?)', lid, rid, position, lesson.title, lesson.body, JSON.stringify(lesson.sources)))
        return lid
      })
      const assessment = assessed ? id('c5', revisionCount) : null
      if (assessment) statements.push(q('INSERT OR IGNORE INTO beam_assessment_revisions (id, course_revision_id, questions_json, pass_percent, max_attempts, practical_instructions, assessor_id) VALUES (?, ?, ?, ?, ?, ?, ?)', assessment, rid, JSON.stringify(questions), draft.passPercent, draft.maxAttempts, data.practical ?? null, data.practical ? member(data.assessor ?? 'maria') : null))
      if (number === current) published.set(key, { revision: rid, number: number + 1, lessons: lessonIds, assessment, questions })
    }
  }
  const dock = versions.get('dock')!
  statements.push(q("INSERT OR IGNORE INTO beam_source_notices (id, course_id, source_id, previous_version_id, new_version_id, state, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)", id('c6', 1), courseId('dock'), id('b0', SOURCES.findIndex(source => source.key === 'dock') + 1), dock[0], dock[1], at(-4)))

  const pathRevision = new Map<Site, string>()
  sites.forEach((site, index) => {
    const path = PATHS[site], pid = id('d0', index + 1), revision = id('d1', index + 1)
    statements.push(
      q('INSERT OR IGNORE INTO beam_paths (id, name, team_id, current_revision_id, created_at) VALUES (?, ?, ?, ?, ?)', pid, path.name, team(site), revision, at(path.at)),
      q('INSERT OR IGNORE INTO beam_path_revisions (id, path_id, number, created_by, created_at) VALUES (?, ?, 1, ?, ?)', revision, pid, member(site === 'joliet' ? 'keisha' : 'nadia'), at(path.at)),
      ...path.requirements.map((requirement, position) => q('INSERT OR IGNORE INTO beam_path_requirements (path_revision_id, position, course_id, prerequisite_course_id, due_days, renewal_days) VALUES (?, ?, ?, ?, ?, ?)',
        revision, position, courseId(requirement.course), 'prerequisite' in requirement ? courseId(requirement.prerequisite) : null, requirement.dueDays, 'renewalDays' in requirement ? requirement.renewalDays : null)),
    )
    pathRevision.set(site, revision)
  })
  const requirementOf = (site: Site | undefined, key: CourseKey) => site ? (PATHS[site].requirements as readonly { course: CourseKey; prerequisite?: CourseKey; dueDays: number; renewalDays?: number }[]).find(item => item.course === key) : undefined
  const pathFor = (person: Person, key: CourseKey) => requirementOf(siteOf(person), key) ? siteOf(person) : undefined
  // CA harassment is assigned directly to every California employee and renews every two years.
  const renewal = (site: Site | undefined, key: CourseKey) => key === 'harassment' ? 730 : requirementOf(site, key)?.renewalDays ?? null

  // The owner attests every session; nobody attests their own attendance.
  for (const [key, session] of Object.entries(SESSIONS)) {
    statements.push(q('INSERT OR IGNORE INTO beam_offline_sessions (id, course_id, course_revision_id, held_on, instructor, location, attested_by, attestation, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id('e0', Number(key)), courseId(session.course), published.get(session.course)!.revision, localDate(at(session.held), ZONE), session.instructor, session.location, ownerMember, session.attestation, at(session.held + 1)))
  }
  const heldAt = (session: SessionKey) => zonedInstant(localDate(at(SESSIONS[session].held), ZONE), '12:00', ZONE)
  const certificateNumber = (completion: string, completedAt: number) => `${new Date(completedAt).getUTCFullYear()}-${completion.slice(0, 8).toUpperCase()}`

  let attemptCount = 0
  for (const assignment of ASSIGNMENTS) {
    const current = published.get(assignment.course)!, data = course(assignment.course), aid = id('f0', assignment.n), zone = zoneOf(assignment.learner), when = due(assignment.due, zone)
    const assessor = data.assessor ?? 'maria'
    const requirement = requirementOf(assignment.path, assignment.course)
    const renewalDays = renewal(assignment.path, assignment.course)
    const done = assignment.completed?.method === 'offline' ? 0 : assignment.completed ? current.lessons.length : assignment.lessonsDone ?? 0
    statements.push(q("INSERT OR IGNORE INTO beam_assignments (id, learner_id, course_id, course_revision_id, path_revision_id, prerequisite_course_id, renewal_days, due_date, due_time, timezone, due_at, status, reason, last_lesson_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '17:00', ?, ?, ?, ?, ?, ?, ?)",
      aid, member(assignment.learner), courseId(assignment.course), current.revision, assignment.path ? pathRevision.get(assignment.path)! : null, requirement?.prerequisite ? courseId(requirement.prerequisite) : null, renewalDays,
      when.date, zone, when.at, assignment.completed ? 'completed' : 'open', assignment.path ? 'path' : 'assigned', current.lessons[done] ?? null, member('nadia'), at(assignment.assigned, 2)))
    current.lessons.slice(0, done).forEach((lesson, position) => statements.push(q('INSERT OR IGNORE INTO beam_lesson_progress (assignment_id, lesson_revision_id, completed_at) VALUES (?, ?, ?)', aid, lesson, at(assignment.assigned + 1 + position * 0.5, 9))))
    let quizAttempt: string | null = null, practicalAttempt: string | null = null
    const allowed = data.maxAttempts ?? 0
    for (const [index, quiz] of (assignment.quiz ?? []).entries()) {
      const tid = id('f1', ++attemptCount)
      const responses = current.questions.map((question, position) => ({ question: question.id, selected: quiz.answers[position], correct: JSON.stringify(quiz.answers[position]) === JSON.stringify(question.correct) }))
      const points = responses.filter(response => response.correct).length, passPercent = data.passPercent!
      const passed = Math.floor(points * 100 / responses.length) >= passPercent, left = allowed - index - 1
      const decision = passed ? 'passed' : left > 0 ? `retry allowed: ${left} attempt${left === 1 ? '' : 's'} remaining` : 'no attempts remaining: a manager may grant another attempt'
      if (passed) quizAttempt = tid
      statements.push(q("INSERT OR IGNORE INTO beam_attempts (id, assignment_id, assessment_revision_id, kind, number, submitted_at, score, max_score, passed, scoring_rule, retry_decision, state) VALUES (?, ?, ?, 'quiz', ?, ?, ?, ?, ?, ?, ?, 'scored')",
        tid, aid, current.assessment, index + 1, at(quiz.at, 10), points, responses.length, passed ? 1 : 0, `exact choice match per question; pass at ${passPercent}%`, decision),
        ...responses.map(response => q('INSERT OR IGNORE INTO beam_responses (attempt_id, question_id, answer_json, correct) VALUES (?, ?, ?, ?)', tid, response.question, JSON.stringify(response.selected), response.correct ? 1 : 0)))
    }
    if (assignment.practical) {
      const tid = id('f1', ++attemptCount), decided = assignment.practical.decided
      if (decided) practicalAttempt = tid
      statements.push(q("INSERT OR IGNORE INTO beam_attempts (id, assignment_id, assessment_revision_id, kind, number, submitted_at, passed, scoring_rule, retry_decision, state, evidence_text) VALUES (?, ?, ?, 'practical', 1, ?, ?, 'named assessor decision', ?, ?, ?)",
        tid, aid, current.assessment, at(assignment.practical.at, 11), decided ? 1 : null, decided ? 'accepted by the named assessor' : 'awaiting the named assessor', decided ? 'accepted' : 'awaiting_review', assignment.practical.evidence))
      if (decided) statements.push(q("INSERT OR IGNORE INTO beam_review_decisions (id, attempt_id, assessor_id, decision, note, decided_at) VALUES (?, ?, ?, 'accepted', ?, ?)", id('f2', attemptCount), tid, member(assessor), decided.note, at(decided.at, 12)))
    }
    if (assignment.completed) {
      const completion = id('f3', assignment.n), session = assignment.completed.session
      const completedAt = session ? heldAt(session) : at(assignment.completed.at, 12)
      const expires = renewalDays ? completedAt + renewalDays * DAY : null
      const evidence = session ? { offlineSession: id('e0', session), instructor: SESSIONS[session].instructor, attestedBy: ownerMember, attachment: null } : { lessons: current.lessons, quizAttempt, practicalAttempt }
      const recordedBy = member(practicalAttempt ? assessor : session ? 'owner' : assignment.learner)
      statements.push(
        q('INSERT OR IGNORE INTO beam_completions (id, assignment_id, learner_id, course_id, course_revision_id, assessment_revision_id, method, evidence_json, completed_at, expires_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          completion, aid, member(assignment.learner), courseId(assignment.course), current.revision, assignment.completed.method === 'assessed' ? current.assessment : null, assignment.completed.method, JSON.stringify(evidence), completedAt, expires, recordedBy),
        q('INSERT OR IGNORE INTO beam_certificates (id, completion_id, number, issuer, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', id('f4', assignment.n), completion, certificateNumber(completion, completedAt), BUSINESS, completedAt, expires),
        q("INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, 'completion.record', ?, ? WHERE changes() = 1", completedAt, recordedBy, completion, JSON.stringify({ assignment: aid, method: assignment.completed.method })),
      )
    }
  }

  // The crew: one assignment each, completed from an attested session or still open.
  const crew = crewRecords().map((row, index) => {
    const zone = zoneOf(row.learner), path = pathFor(row.learner, row.course), current = published.get(row.course)!
    const completedAt = row.session ? heldAt(row.session) : null
    const when = completedAt ? due(SESSIONS[row.session!].held + 7, zone) : due(row.due!, zone)
    return { ...row, n: index + 1, zone, path, current, completedAt, when, renewalDays: renewal(path, row.course), assigned: completedAt ? completedAt - 14 * DAY : at(-12) }
  })
  statements.push(
    ...inserts(db, 'INSERT OR IGNORE INTO beam_assignments (id, learner_id, course_id, course_revision_id, path_revision_id, renewal_days, due_date, due_time, timezone, due_at, status, reason, last_lesson_id, assigned_by, assigned_at)',
      crew.map(row => [id('f5', row.n), member(row.learner), courseId(row.course), row.current.revision, row.path ? pathRevision.get(row.path)! : null, row.renewalDays, row.when.date, '17:00', row.zone, row.when.at, row.completedAt ? 'completed' : 'open', row.path ? 'path' : 'assigned', row.current.lessons[0], member('nadia'), row.assigned])),
    ...inserts(db, 'INSERT OR IGNORE INTO beam_completions (id, assignment_id, learner_id, course_id, course_revision_id, method, evidence_json, completed_at, expires_at, recorded_by)',
      crew.filter(row => row.completedAt).map(row => [id('f6', row.n), id('f5', row.n), member(row.learner), courseId(row.course), row.current.revision, 'offline', JSON.stringify({ offlineSession: id('e0', row.session!), instructor: SESSIONS[row.session!].instructor, attestedBy: ownerMember, attachment: null }), row.completedAt, row.renewalDays ? row.completedAt! + row.renewalDays * DAY : null, ownerMember])),
    ...inserts(db, 'INSERT OR IGNORE INTO beam_certificates (id, completion_id, number, issuer, issued_at, expires_at)',
      crew.filter(row => row.completedAt).map(row => [id('f7', row.n), id('f6', row.n), certificateNumber(id('f6', row.n), row.completedAt!), BUSINESS, row.completedAt, row.renewalDays ? row.completedAt! + row.renewalDays * DAY : null])),
  )

  // The business's own agent prepares reminders and plans through Nadia Flores's preparation credential; people decide.
  const followedRow = (n: number) => ASSIGNMENTS.find(item => item.n === n)!
  const learnerName = (person: Person) => person === 'owner' ? ownerName : nameOf(person)
  const assignmentInput = (n: number) => { const row = followedRow(n); return { type: 'assignment', id: id('f0', n), label: `${learnerName(row.learner)}'s ${course(row.course).title} assignment` } }
  const weekday = (days: number, locale: string) => new Intl.DateTimeFormat(locale, { timeZone: ZONE, weekday: 'long' }).format(at(days))
  const overdueReason = (n: number) => { const row = followedRow(n); return `${learnerName(row.learner)}'s ${course(row.course).title} was due ${weekday(row.due, 'en-US')}, with ${row.lessonsDone ?? 0} of ${course(row.course).lessons.length} lessons done.` }
  const expiringLift = crew.filter(row => row.course === 'lift' && row.session === 6)
  const renewalsPlan = [{ learner: 'juan' as Person }, ...expiringLift].map(row => ({ learner: member(row.learner), course: courseId('lift'), courseRevision: published.get('lift')!.revision, dueDate: localDate(at(14), ZONE), dueTime: '17:00', timezone: ZONE }))
  const PROPOSALS: { n: number; kind: 'reminders' | 'assignment_plan'; title: string; at: number; inputs: object[]; reasons: string[]; excluded: { item: string; reason: string }[]; payload: object; decided?: { state: 'approved' | 'declined'; by: Person; at: number; note: string; result: object | null } }[] = [
    { n: 1, kind: 'reminders', title: 'Reminders for four overdue courses', at: clock(0, '06:05'), inputs: [1, 7, 8, 6].map(assignmentInput),
      reasons: [1, 7, 8, 6].map(overdueReason).concat('Ray Ortiz is on leave, so the reminders come from Nadia Flores for his team.'),
      excluded: [{ item: 'Ines Varga, Lift-truck safety', reason: 'Her practical evidence is waiting for Maria Chen; a reminder would not help.' }],
      payload: { items: [
        { assignment: id('f0', 1), message: `Hola Tomás, tu curso anual de concienciación sobre fugas de amoníaco venció el ${weekday(-3, 'es')}. Son unos 15 minutos, en horario pagado, antes de que termine tu turno.\n\nHi Tomás, your annual ammonia release awareness course was due ${weekday(-3, 'en-US')}. It takes about 15 minutes, in paid time, before your shift ends.` },
        { assignment: id('f0', 7), message: 'Hi Tyrone, Lift-truck safety is a week overdue and one lesson is left: pedestrians and dock edges. Keisha can cover your door while you finish it in paid time.' },
        { assignment: id('f0', 8), message: 'Hi Hannah, Security awareness is overdue: two short lessons and a two-question quiz. Please finish it in paid time this week.' },
        { assignment: id('f0', 6), message: 'Hi Miguel, Cold room safety & PPE is overdue with one lesson left: warm-up breaks. Please finish it before your next cooler shift.' }] } },
    { n: 2, kind: 'assignment_plan', title: `Lift-truck renewals for ${renewalsPlan.length} operators`, at: clock(0, '06:10'), inputs: [{ type: 'course_revision', id: published.get('lift')!.revision, label: `Lift-truck safety revision ${published.get('lift')!.number}` }],
      reasons: [`Juan Morales and ${expiringLift.length} other Fresno operators were evaluated ${Math.abs(SESSIONS[6].held)} days ago; their three-year lift-truck certificates expire within 30 days.`, 'Maria Chen has evaluation slots in the next two weeks.'],
      excluded: [{ item: 'Ines Varga', reason: 'Her current Lift-truck safety assignment is still open.' }],
      payload: { items: renewalsPlan } },
    { n: 3, kind: 'reminders', title: 'Ammonia course for Rafael Medina', at: clock(-1, '07:30'), inputs: [assignmentInput(2)],
      reasons: ['Rafael Medina started in Fresno on Friday; ammonia release awareness comes before his first cooler shift.'], excluded: [],
      payload: { items: [{ assignment: id('f0', 2), message: 'Hola Rafael, welcome to Sierra Lakes. Please do Ammonia release awareness before your first cooler shift: three short lessons, in paid time.' }] },
      decided: { state: 'approved', by: 'nadia', at: clock(-1, '07:42'), note: 'Good, before Monday.', result: { delivered: [id('f0', 2)], skipped: [] } } },
    { n: 4, kind: 'reminders', title: 'Cold room reminder for Rosa Jimenez', at: clock(-1, '14:55'), inputs: [assignmentInput(10)],
      reasons: ['Rosa Jimenez\'s Cold room safety & PPE is due in four days and the practical is not accepted yet.'], excluded: [],
      payload: { items: [{ assignment: id('f0', 10), message: 'Hi Rosa, your cold room course is due soon: the practical still needs its sign-off.' }] },
      decided: { state: 'declined', by: 'owner', at: clock(-1, '15:20'), note: 'Rosa already sent her evidence; I will assess it today.', result: null } },
  ]
  for (const proposal of PROPOSALS) {
    const pid = id('g0', proposal.n), decided = proposal.decided
    statements.push(q("INSERT OR IGNORE INTO beam_agent_proposals (id, kind, title, agent, prepared_by, via_agent, inputs_json, reasons_json, excluded_json, payload_json, payload_sha256, state, decided_by, decided_at, decision_note, result_json, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      pid, proposal.kind, proposal.title, AGENT, member('nadia'), JSON.stringify(proposal.inputs), JSON.stringify(proposal.reasons), JSON.stringify(proposal.excluded), JSON.stringify(proposal.payload), await payloadDigest(proposal.payload),
      decided?.state ?? 'waiting', decided ? member(decided.by) : null, decided?.at ?? null, decided?.note ?? null, decided ? JSON.stringify(decided.result) : null, proposal.at))
  }
  statements.push(q('INSERT OR IGNORE INTO beam_reminder_messages (id, assignment_id, learner_id, body, proposal_id, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id('g1', 1), id('f0', 2), member('rafael'), 'Hola Rafael, welcome to Sierra Lakes. Please do Ammonia release awareness before your first cooler shift: three short lessons, in paid time.', id('g0', 3), member('nadia'), clock(-1, '07:42')))
  await db.batch(statements)
}
