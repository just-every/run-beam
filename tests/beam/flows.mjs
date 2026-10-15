import { queuedEntrypoint } from '@runeditrun/rer/queued-entry'
const queued = await queuedEntrypoint(import.meta.url, 'test:flows'); if (queued !== null) process.exit(queued)
// Beam's contract clauses, each exercised through public HTTP doors against
// the built Worker with real local D1 and R2. No provider is involved.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { courseListCsv, courseReport, pdf, procedureV1, procedureV2 } from './fixtures.mjs'
import { file, harness } from './harness.mjs'
import { agentFlows } from './agent-flows.mjs'

const h = await harness()
const sha = value => createHash('sha256').update(value).digest('hex')
const check = async (id, run) => { await run(); console.log(`${id} passed`) }
const people = {}, ids = {}
const publish = async (revision, fields = {}) => {
  const result = await h.submit('revision.decide', people.reviewer, { revision, decision: 'publish', ...fields })
  assert.equal(result.searchParams.get('error'), null)
  assert.equal((await h.api(`revisions/${revision}`, people.reviewer)).revision.state, 'published')
}
const lessonsOf = async (cookie, assignment) => (await h.api(`assignments/${assignment}`, cookie)).lessons

try {
  await check('BEAM-01', async () => {
    // One-time owner claim, ordinary sign-in, first-run confirmation.
    assert.equal((await h.raw('/auth/bootstrap', { body: { token: h.vars.SETUP_TOKEN, displayName: 'Olive Owner' } })).status, 303)
    assert.notEqual((await h.raw('/auth/bootstrap', { body: { token: h.vars.SETUP_TOKEN, displayName: 'Second' } })).status, 303)
    people.owner = await h.signIn(h.vars.OWNER_EMAIL)
    assert.equal((await h.raw('/setup', { cookie: people.owner, form: new URLSearchParams({ confirm: 'yes' }) })).status, 303)
    assert.equal((await h.raw('/api/beam/me')).status, 401)
    assert.equal((await h.raw('/app')).status, 303)
    // The owner names the business and its time zone before anything else.
    assert.equal((await h.raw('/app', { cookie: people.owner })).headers.get('location'), `${h.origin}/app/business`)
    await h.api('business.configure', people.owner, { name: 'Harbour Physio', timezone: 'Mars/Olympus' }, 400)
    const saved = await h.submit('business.configure', people.owner, { name: 'Harbour Physio', timezone: 'Australia/Sydney' })
    assert.equal(saved.searchParams.get('notice'), 'Saved.')
    assert.deepEqual((await h.api('me', people.owner)).business, { name: 'Harbour Physio', timezone: 'Australia/Sydney' })
    // Adult staff are invited with learning roles; each accepts an ordinary emailed invitation.
    const staff = { author: ['ana@example.test', 'Ana Ruiz', ['author', 'learner']], reviewer: ['priya@example.test', 'Priya Shah', ['reviewer', 'learner']], manager: ['tom@example.test', 'Tom Okafor', ['manager', 'assessor', 'learner']], sam: ['sam@example.test', 'Sam Lee', ['learner']], lee: ['lee@example.test', 'Lee Park', ['learner']] }
    for (const [key, [email, name, roles]] of Object.entries(staff)) {
      ids[key] = (await h.api('person.invite', people.owner, { email, name, roles })).id
      people[key] = await h.signIn(email, { requested: true })
    }
    await h.api('person.invite', people.manager, { email: 'x@example.test', name: 'X', roles: ['learner'] }, 403)
    assert.deepEqual((await h.api('me', people.sam)).roles, ['learner'])
    await h.api('course.create', people.sam, { title: 'Nope', reviewer: ids.reviewer }, 403)
    await h.api('people', people.sam, undefined, 403)
    ids.team = (await h.api('team.create', people.manager, { name: 'Front desk' })).id
    await h.api('team.members', people.manager, { team: ids.team, members: [ids.sam, ids.lee] })
    // Removing access ends the person's sessions; restoring it needs a fresh sign-in.
    await h.api('person.access', people.owner, { email: 'lee@example.test', status: 'inactive' })
    await h.api('me', people.lee, undefined, 401)
    await h.api('person.access', people.owner, { email: 'lee@example.test', status: 'active' })
    await h.api('me', people.lee, undefined, 401)
    people.lee = await h.signIn('lee@example.test')
    await h.api('me', people.lee)
  })

  await check('BEAM-02', async () => {
    await h.api('source.create', people.author, { title: 'Opening procedure', licence: 'borrowed', licenceEvidence: 'x', reviewer: ids.reviewer, provenance: 'x', file: file('opening.txt', procedureV1) }, 400)
    const source = await h.api('source.create', people.author, { title: 'Opening procedure', licence: 'owned', licenceEvidence: 'Written by the clinic manager in 2024.', reviewer: ids.reviewer, provenance: 'Clinic shared drive, Procedures/Opening.docx exported as text', file: file('opening.txt', procedureV1) })
    assert.equal(source.sha256, sha(procedureV1))
    Object.assign(ids, { source: source.id, sourceV1: source.versionId })
    const listed = (await h.api('sources', people.reviewer)).find(row => row.id === source.id)
    assert.equal(listed.reviewer, ids.reviewer)
    assert.equal(listed.versions[0].provenance, 'Clinic shared drive, Procedures/Opening.docx exported as text')
    await h.api('sources', people.sam, undefined, 403)
    const bytes = await h.raw(`/app/files/source/${ids.sourceV1}?download=1`, { cookie: people.author })
    assert.equal(sha(Buffer.from(await bytes.arrayBuffer())), sha(procedureV1))
    // A learner cannot open material that is not part of their training.
    assert.equal((await h.raw(`/app/files/source/${ids.sourceV1}`, { cookie: people.sam })).status, 404)
    // Uploaded content is inert data: markup is served as sandboxed plain text.
    const markup = await h.api('source.create', people.author, { title: 'Pasted page', licence: 'owned', licenceEvidence: 'Ours', reviewer: ids.reviewer, provenance: 'Pasted', file: file('page.html', '<html><script>alert(1)</script></html>') })
    const served = await h.raw(`/app/files/source/${markup.versionId}`, { cookie: people.author })
    assert.match(served.headers.get('content-type'), /^text\/plain/)
    assert.match(served.headers.get('content-security-policy'), /sandbox/)
    const evidence = await h.api('source.create', people.author, { title: 'Fridge log template', licence: 'owned', licenceEvidence: 'Ours', reviewer: ids.reviewer, provenance: 'Scanned', file: file('fridge.pdf', pdf) })
    assert.equal(evidence.mediaType, 'application/pdf')
  })

  let draftVersion
  await check('BEAM-03', async () => {
    const course = await h.api('course.create', people.author, { title: 'Opening the clinic', summary: 'How we open each morning.', reviewer: ids.reviewer })
    ids.opening = course.id
    draftVersion = course.draftVersion
    const edit = async (action, fields) => { const result = await h.api(action, people.author, { course: ids.opening, draftVersion, ...fields }); draftVersion = result.draftVersion; return result }
    await edit('course.lesson', { title: 'Before you arrive', body: 'Check the roster.\n\n- Keys\n- Alarm code', sources: [] })
    await edit('course.lesson', { title: 'Opening steps', body: 'Follow the opening procedure.', sources: [ids.sourceV1] })
    await edit('course.question', { prompt: 'What do you do first?', choices: 'Disarm the alarm\nOpen the till', correct: '1' })
    await edit('course.question', { prompt: 'Which are recorded?', choices: 'Fridge temperature\nWeather\nAlarm time', correct: '1,3' })
    await edit('course.assessment', { passPercent: 100, maxAttempts: 2, practicalInstructions: 'Open the clinic with your assessor watching.', assessor: ids.manager })
    // A stale draft version cannot overwrite a newer save.
    await h.api('course.details', people.author, { course: ids.opening, draftVersion: draftVersion - 1, title: 'Lost update', summary: '' }, 409)
    // The form door saves through the same action.
    const location = await h.submit('course.details', people.author, { course: ids.opening, draftVersion, title: 'Opening the clinic', summary: 'How we open each morning, safely.' }, `/app/courses/${ids.opening}`)
    assert.equal(location.pathname, `/app/courses/${ids.opening}`)
    draftVersion += 1
    const first = await h.api('course.submit', people.author, { course: ids.opening, draftVersion })
    await h.api('course.submit', people.author, { course: ids.opening, draftVersion }, 409)
    assert.ok((await h.api('queues', people.reviewer)).reviews.some(row => row.id === first.id))
    await h.api('revision.decide', people.author, { revision: first.id, decision: 'publish' }, 403)
    await h.api('revision.decide', people.manager, { revision: first.id, decision: 'publish' }, 403)
    await h.api('revision.decide', people.reviewer, { revision: first.id, decision: 'return', note: 'Name the fridge log.' })
    await edit('course.lesson', { lesson: (await h.api(`courses/${ids.opening}`, people.author)).draft.lessons[1].id, title: 'Opening steps', body: 'Follow the opening procedure and fill in the fridge log.', sources: [ids.sourceV1] })
    const second = await h.api('course.submit', people.author, { course: ids.opening, draftVersion })
    assert.equal(second.number, 2)
    await publish(second.id)
    const detail = await h.api(`courses/${ids.opening}`, people.reviewer)
    assert.equal(detail.publishedRevision, second.id)
    assert.deepEqual(detail.revisions.map(row => [row.number, row.state]), [[2, 'published'], [1, 'returned']])
    // The published revision is immutable: later draft edits do not change it.
    await edit('course.details', { title: 'Opening the clinic', summary: 'Draft edit after publishing.' })
    assert.equal((await h.api(`revisions/${second.id}`, people.reviewer)).revision.summary, 'How we open each morning, safely.')
    ids.openingRev2 = second.id
  })

  await check('BEAM-04', async () => {
    const records = await h.api('course.create', people.author, { title: 'Handling client records', summary: '', reviewer: ids.reviewer })
    ids.records = records.id
    const lesson = await h.api('course.lesson', people.author, { course: records.id, draftVersion: 1, title: 'Where records live', body: 'Only in the practice system.', sources: [] })
    const revision = await h.api('course.submit', people.author, { course: records.id, draftVersion: lesson.draftVersion })
    await publish(revision.id)
    ids.path = (await h.api('path.create', people.manager, { name: 'Front desk onboarding', team: ids.team })).id
    await h.api('path.revise', people.manager, { path: ids.path, courses: [ids.records], prerequisites: [ids.opening], dueDays: ['14'], renewalDays: [''] }, 400)
    await h.api('path.revise', people.manager, { path: ids.path, courses: [ids.opening, ids.records], prerequisites: ['', ids.opening], dueDays: ['7', '14'], renewalDays: ['', '365'] })
    const assigned = await h.api('path.assign', people.manager, { path: ids.path })
    assert.equal(assigned.created.length, 4)
    assert.equal((await h.api('path.assign', people.manager, { path: ids.path })).created.length, 0)
    const sam = (await h.api('records/me', people.sam)).assignments
    ids.samOpening = sam.find(row => row.course === ids.opening).id
    ids.samRecords = sam.find(row => row.course === ids.records).id
    assert.equal((await h.api(`assignments/${ids.samRecords}`, people.sam)).blocked, true)
    const recordsLesson = (await lessonsOf(people.sam, ids.samRecords))[0]
    await h.api('lesson.complete', people.sam, { assignment: ids.samRecords, lesson: recordsLesson.id }, 409)
    // Editing the path makes revision 2; assignments made from revision 1 keep it.
    const firstRevision = (await h.api('paths', people.manager))[0].revision
    await h.api('path.revise', people.manager, { path: ids.path, courses: [ids.opening, ids.records], prerequisites: ['', ids.opening], dueDays: ['7', '21'], renewalDays: ['', '365'] })
    assert.equal((await h.api('paths', people.manager))[0].number, 2)
    assert.equal((await h.api(`assignments/${ids.samRecords}`, people.sam)).assignment.pathRevision, firstRevision)
  })

  await check('BEAM-05', async () => {
    await h.api('assignment.create', people.sam, { course: ids.opening, learners: [ids.author], dueDate: '2030-03-01' }, 403)
    await h.api('assignment.create', people.manager, { course: ids.opening, learners: [ids.author], dueDate: '2030-02-30', dueTime: '09:00', timezone: 'America/New_York' }, 400)
    await h.api('assignment.create', people.manager, { course: ids.opening, learners: [ids.author], dueDate: '2030-03-01', dueTime: '09:00', timezone: 'Nowhere/Else' }, 400)
    const made = await h.api('assignment.create', people.manager, { course: ids.opening, learners: [ids.author], teams: [ids.team], dueDate: '2030-03-01', dueTime: '09:00', timezone: 'America/New_York' })
    assert.equal(made.created.length, 1, 'team members already holding an open assignment keep it')
    assert.equal(made.kept.length, 2)
    const view = (await h.api(`assignments/${made.created[0]}`, people.author)).assignment
    assert.equal(view.timezone, 'America/New_York')
    assert.equal(view.dueAt, Date.UTC(2030, 2, 1, 14, 0))
    assert.equal(view.revision, ids.openingRev2)
  })

  await check('BEAM-06', async () => {
    const lessons = await lessonsOf(people.sam, ids.samOpening)
    assert.equal((await h.api(`assignments/${ids.samOpening}`, people.sam)).resumeLesson, lessons[0].id)
    await h.api('quiz.submit', people.sam, { assignment: ids.samOpening }, 409)
    await h.api('lesson.complete', people.sam, { assignment: ids.samOpening, lesson: lessons[0].id })
    // A second device: a new session for the same person resumes at the next lesson.
    const phone = await h.signIn('sam@example.test')
    const resumed = await h.api(`assignments/${ids.samOpening}`, phone)
    assert.equal(resumed.resumeLesson, lessons[1].id)
    assert.deepEqual(resumed.lessons.map(lesson => lesson.completed), [true, false])
    const pageHtml = await (await h.raw(`/app/learn/${ids.samOpening}`, { cookie: phone })).text()
    assert.ok(pageHtml.includes(`/app/learn/${ids.samOpening}/lessons/${lessons[1].id}`))
    // The procedure cited by an assigned lesson opens for its learner.
    assert.equal((await h.raw(`/app/files/source/${ids.sourceV1}`, { cookie: phone })).status, 200)
    await h.api('lesson.complete', people.sam, { assignment: ids.samOpening, lesson: lessons[1].id })
  })

  await check('BEAM-07', async () => {
    const view = await h.api(`assignments/${ids.samOpening}`, people.sam)
    const [q1, q2] = view.quiz.questions
    assert.equal(q2.multiple, true)
    const wrong = { assignment: ids.samOpening, [`q_${q1.id}`]: ['1'], [`q_${q2.id}`]: ['0'] }
    const first = await h.api('quiz.submit', people.sam, wrong)
    const second = await h.api('quiz.submit', people.sam, wrong)
    assert.deepEqual([first.score, first.passed, second.score, second.passed], [0, false, 0, false])
    assert.match(first.retryDecision, /1 attempt remaining/)
    assert.match(second.retryDecision, /no attempts remaining/)
    await h.api('quiz.submit', people.sam, wrong, 409)
    assert.ok((await h.api('queues', people.manager)).attemptsExhausted.some(row => row.id === ids.samOpening))
    await h.api('attempt.grant', people.manager, { assignment: ids.samOpening, reason: 'Retrained on the alarm panel.' })
    const passed = await h.api('quiz.submit', people.sam, { assignment: ids.samOpening, [`q_${q1.id}`]: ['0'], [`q_${q2.id}`]: ['0', '2'] })
    assert.deepEqual([passed.score, passed.maxScore, passed.passed, passed.completion], [2, 2, true, null])
    const detail = await h.api(`attempts/${passed.id}`, people.sam)
    assert.match(detail.scoringRule, /exact choice match/)
    assert.deepEqual(detail.responses.map(row => row.correct).sort(), [1, 1])
    ids.samQuiz = passed.id
  })

  await check('BEAM-08', async () => {
    const practical = await h.api('practical.submit', people.sam, { assignment: ids.samOpening, evidence: 'Opened on Tuesday with Tom; fridge 4°C logged.', file: file('fridge-log.pdf', pdf) })
    ids.samPractical = practical.id
    assert.ok((await h.api('queues', people.manager)).assessments.some(row => row.id === practical.id))
    await h.api('practical.decide', people.owner, { attempt: practical.id, decision: 'accepted', note: 'Owner override' }, 403)
    await h.api('practical.decide', people.reviewer, { attempt: practical.id, decision: 'accepted', note: 'Looks fine' }, 403)
    assert.equal((await h.api(`assignments/${ids.samOpening}`, people.sam)).completion, null, 'no completion while the assessor has not decided')
    const decided = await h.api('practical.decide', people.manager, { attempt: practical.id, decision: 'accepted', note: 'Observed the full opening.' })
    assert.ok(decided.completion)
    const detail = await h.api(`attempts/${practical.id}`, people.sam)
    assert.deepEqual([detail.decision.assessor, detail.decision.decision], [ids.manager, 'accepted'])
  })

  await check('BEAM-09', async () => {
    const view = await h.api(`assignments/${ids.samOpening}`, people.sam)
    assert.equal(view.assignment.status, 'completed')
    assert.equal(view.completion.revision, ids.openingRev2)
    const revision = await h.api(`revisions/${ids.openingRev2}`, people.reviewer)
    assert.equal(view.completion.assessmentRevision, revision.assessment.id)
    const sam = await h.api('records/me', people.sam)
    const completion = sam.completions.find(row => row.course === ids.opening)
    assert.equal(completion.method, 'assessed')
    assert.deepEqual([completion.evidence.quizAttempt, completion.evidence.practicalAttempt], [ids.samQuiz, ids.samPractical])
    // Lee has read one lesson: nothing can turn that into a completion.
    const leeOpening = (await h.api('records/me', people.lee)).assignments.find(row => row.course === ids.opening).id
    const leeLessons = await lessonsOf(people.lee, leeOpening)
    await h.api('lesson.complete', people.lee, { assignment: leeOpening, lesson: leeLessons[0].id })
    await h.api('practical.submit', people.lee, { assignment: leeOpening, evidence: 'Done' }, 409)
    await h.api('quiz.submit', people.lee, { assignment: leeOpening }, 409)
    assert.equal((await h.api('records/me', people.lee)).completions.length, 0)
    // Publishing revision 3 and reassigning keeps Sam's revision-2 evidence intact.
    const draft = (await h.api(`courses/${ids.opening}`, people.author)).draftVersion
    const third = await h.api('course.submit', people.author, { course: ids.opening, draftVersion: draft })
    await publish(third.id, { reassignment: 'everyone', dueDays: 21 })
    const reassignedPeople = await Promise.all(['sam', 'lee', 'author'].map(person => h.api('records/me', people[person])))
    const replacements = reassignedPeople.flatMap(record => record.assignments.filter(row => row.course === ids.opening && row.status === 'open'))
    assert.equal(replacements.length, 3, 'Lee and Ana move to revision 3, Sam is reassigned')
    for (const record of reassignedPeople) {
      const current = record.assignments.find(row => row.course === ids.opening && row.status === 'open')
      assert.ok(current)
      assert.equal((await h.api(`assignments/${current.id}`, people.manager)).assignment.revision, third.id)
    }
    ids.openingRev3 = third.id
    const after = await h.api('records/me', people.sam)
    assert.equal(after.completions.find(row => row.course === ids.opening).revision, ids.openingRev2)
    const reassigned = after.assignments.find(row => row.course === ids.opening && row.status === 'open')
    assert.equal(reassigned.reason, 'revision')
    assert.equal((await h.api(`assignments/${reassigned.id}`, people.sam)).assignment.revision, ids.openingRev3)
    const lee = await h.api('records/me', people.lee)
    assert.deepEqual(lee.assignments.filter(row => row.course === ids.opening).map(row => row.status).sort(), ['open', 'replaced'])
  })

  await check('BEAM-10', async () => {
    const fields = { course: ids.records, revision: (await h.api(`courses/${ids.records}`, people.author)).publishedRevision, learners: [ids.lee], heldOn: '2025-06-01', instructor: 'Dr Mia Chen', location: 'Harbour Physio meeting room', attestation: 'Lee attended the full privacy session.', file: file('attendance.pdf', pdf) }
    await h.api('offline.record', people.sam, fields, 403)
    await h.api('offline.record', people.manager, { ...fields, heldOn: '2099-01-01' }, 400)
    const recorded = await h.api('offline.record', people.manager, fields)
    const completion = (await h.api('records/me', people.lee)).completions.find(row => row.course === ids.records)
    assert.equal(completion.method, 'offline')
    assert.deepEqual([completion.evidence.offlineSession, completion.evidence.instructor, completion.evidence.attestedBy], [recorded.session, 'Dr Mia Chen', ids.manager])
    assert.ok(completion.evidence.attachment)
    const held = Date.parse('2025-06-01T02:00:00Z')
    assert.deepEqual([completion.completedAt, completion.expiresAt], [held, held + 365 * 86_400_000], 'held at noon Sydney time; renews after the path’s 365 days')
    ids.leeRecordsCertificate = completion.certificate
  })

  await check('BEAM-11', async () => {
    const samCertificate = (await h.api('records/me', people.sam)).completions.find(row => row.course === ids.opening).certificate
    const certificate = await h.api(`certificates/${samCertificate}`, people.sam)
    assert.deepEqual([certificate.issuer, certificate.learner, certificate.course, certificate.revision, certificate.expiresAt], ['Harbour Physio', 'Sam Lee', 'Opening the clinic', 2, null])
    assert.ok(certificate.number)
    const lee = await h.api(`certificates/${ids.leeRecordsCertificate}`, people.manager)
    assert.ok(lee.expiresAt)
    await h.api(`certificates/${ids.leeRecordsCertificate}`, people.sam, undefined, 404)
    const html = await (await h.raw(`/app/certificates/${samCertificate}`, { cookie: people.sam })).text()
    assert.ok(html.includes('Harbour Physio') && html.includes('revision 2'))
  })

  await check('BEAM-12', async () => {
    // Lee's offline completion expired on 1 June 2026: a renewal is due.
    const due = (await h.api('queues', people.manager)).renewals
    assert.ok(due.some(row => row.learner === ids.lee && row.course === ids.records))
    const renewed = await h.api('assignment.renewals', people.manager, {})
    assert.equal(renewed.created.length, 1)
    assert.ok(!(await h.api('queues', people.manager)).renewals.some(row => row.learner === ids.lee))
    // An overdue assignment reminds the learner and appears in the manager's queue.
    const overdue = await h.api('assignment.create', people.manager, { course: ids.records, learners: [ids.author], dueDate: '2026-01-05', dueTime: '17:00', timezone: 'Australia/Sydney' })
    assert.ok((await h.api('reminders', people.author)).some(row => row.id === overdue.created[0] && row.kind === 'overdue'))
    assert.ok((await h.api('queues', people.manager)).overdue.some(row => row.id === overdue.created[0]))
    assert.ok(!(await h.api('reminders', people.sam)).some(row => row.id === overdue.created[0]))
    const dashboard = await (await h.raw('/app', { cookie: people.author })).text()
    assert.match(dashboard, /overdue since/i)
  })

  await check('BEAM-13', async () => {
    for (const path of [`attempts/${ids.samQuiz}`, `attempts/${ids.samPractical}`, `assignments/${ids.samOpening}`, `records/${ids.sam}`]) await h.api(path, people.lee, undefined, 404)
    const attachment = (await h.api(`attempts/${ids.samPractical}`, people.sam)).attachment
    assert.equal((await h.raw(`/app/files/attachment/${attachment}`, { cookie: people.lee })).status, 404)
    assert.equal((await h.raw(`/app/files/attachment/${attachment}`, { cookie: people.sam })).status, 200)
    await h.api(`attempts/${ids.samQuiz}`, people.manager)
    await h.api(`attempts/${ids.samQuiz}`, people.reviewer, undefined, 404)
    assert.equal((await h.raw('/app/files/attachment/' + attachment)).status, 303)
    // Cross-site posts are refused before any action runs.
    const forged = await fetch(`${h.origin}/api/beam/business.configure`, { method: 'POST', headers: { cookie: people.owner, origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Taken', timezone: 'UTC' }) })
    assert.equal(forged.status, 403)
    assert.equal((await h.api('me', people.owner)).business.name, 'Harbour Physio')
  })

  await check('BEAM-14', async () => {
    const version = await h.api('source.version', people.author, { source: ids.source, provenance: 'Updated after the fridge audit', file: file('opening.txt', procedureV2) })
    assert.deepEqual(version.flaggedCourses, [ids.opening])
    const notice = (await h.api('queues', people.reviewer)).notices.find(row => row.course === ids.opening)
    assert.ok(notice)
    // A human-authored proposal records its inputs. The scoped agent door is
    // exercised separately by regressions.mjs.
    const course = await h.api(`courses/${ids.opening}`, people.author)
    const proposed = structuredClone(course.draft)
    proposed.lessons[1].body = 'Follow the opening procedure, record the fridge temperature in the log.'
    proposed.lessons[1].sources = [version.id]
    const stale = await h.api('proposal.create', people.author, { course: ids.opening, draftVersion: course.draftVersion, summary: 'Reflect procedure v2', agent: 'Human preparation', inputs: [version.id], draft: proposed })
    await h.api('course.details', people.author, { course: ids.opening, draftVersion: course.draftVersion, title: 'Opening the clinic', summary: 'Edited meanwhile.' })
    await h.api('proposal.decide', people.reviewer, { proposal: stale.id, decision: 'accept' }, 409)
    const fresh = await h.api('proposal.create', people.author, { course: ids.opening, draftVersion: course.draftVersion + 1, summary: 'Reflect procedure v2', agent: 'Human preparation', inputs: [version.id], draft: proposed })
    await h.api('proposal.decide', people.reviewer, { proposal: fresh.id, decision: 'accept' })
    const updated = await h.api(`courses/${ids.opening}`, people.author)
    assert.deepEqual(updated.draft.lessons[1].sources, [version.id])
    assert.deepEqual(updated.proposals.find(row => row.id === fresh.id).inputs, [version.id])
    assert.equal(updated.publishedRevision, ids.openingRev3, 'an accepted proposal changes the draft, never the published revision')
    await h.api('notice.decide', people.author, { notice: notice.id, decision: 'draft_updated', note: 'x' }, 403)
    await h.api('notice.decide', people.reviewer, { notice: notice.id, decision: 'draft_updated', note: 'The fridge step changed; revising.' })
    assert.ok(!(await h.api('queues', people.reviewer)).notices.length)
  })

  await check('BEAM-15', async () => {
    const report = courseReport({ learnerEmail: 'sam@example.test' })
    const upload = { courseList: file('courses.csv', courseListCsv), report1: file('course-101.xlsx', report), report1Course: '101', dateFormat: 'DMY', map_101: ids.opening }
    await h.api('import.preview', people.manager, upload, 403)
    const preview = await h.api('import.preview', people.owner, upload)
    assert.deepEqual((await h.api('history', people.owner)), [], 'a preview writes nothing')
    assert.equal(preview.completions, 3)
    assert.deepEqual(preview.identities.matched.map(row => row.email), ['sam@example.test'])
    assert.deepEqual(preview.identities.unresolved.map(row => row.email), ['jo.former@example.test'])
    assert.equal(preview.duplicates.length, 1)
    assert.ok(preview.attention.some(row => row.reason.includes('31/31/2025')))
    assert.ok(preview.gaps.some(gap => gap.includes('(102)')))
    assert.deepEqual(preview.courses.map(row => [row.sourceId, row.mappedTo]), [['101', ids.opening], ['102', null]])
    await h.api('import.apply', people.owner, { ...upload, fingerprint: 'f'.repeat(64) }, 409)
    const applied = await h.api('import.apply', people.owner, { ...upload, fingerprint: preview.fingerprint })
    assert.equal(applied.state, 'completed')
    const history = await h.api('history', people.owner)
    assert.equal(history.length, 5)
    const completions = history.filter(row => row.kind === 'completion')
    assert.deepEqual(completions.map(row => [row.email, row.completedOn]).sort(), [['jo.former@example.test', '2025-03-24'], ['sam@example.test', '2024-02-02'], ['sam@example.test', '2025-03-14']])
    assert.ok(completions.every(row => row.historical && row.source === 'TalentLMS'))
    // Imported history is labelled evidence and completes nothing current.
    const sam = await h.api('records/me', people.sam)
    assert.equal(sam.history.length, 2)
    assert.equal(sam.completions.length, 1)
    // The same export again adds no rows.
    const again = await h.api('import.preview', people.owner, upload)
    await h.api('import.apply', people.owner, { ...upload, fingerprint: again.fingerprint })
    assert.equal((await h.api('history', people.owner)).length, 5)
    const jobs = await h.api('imports', people.owner)
    assert.equal(jobs.length, 2)
    const undoAll = async () => { for (const job of new Set((await h.api('imports', people.owner)).filter(job => job.state === 'completed').map(job => job.id))) await h.api('import.job', people.owner, { job, action: 'undo' }) }
    // After Undo, the owner can review the same files and apply them again.
    await undoAll()
    assert.equal((await h.api('history', people.owner)).length, 0)
    const reviewedAgain = await h.api('import.preview', people.owner, upload)
    assert.equal((await h.api('import.apply', people.owner, { ...upload, fingerprint: reviewedAgain.fingerprint })).state, 'completed')
    assert.equal((await h.api('history', people.owner)).length, 5)
    // Jo joins after the import. The preview names the records imported earlier with other details, and apply refuses
    // them before creating any job; undoing the earlier import is the way to bring them across again.
    await h.api('person.invite', people.owner, { email: 'jo.former@example.test', name: 'Jo Former', roles: ['learner'] })
    const joined = await h.api('import.preview', people.owner, upload)
    assert.deepEqual(joined.identities.unresolved, [])
    assert.ok(joined.changed.length > 0)
    const imports = (await h.api('imports', people.owner)).length
    await h.api('import.apply', people.owner, { ...upload, fingerprint: joined.fingerprint }, 409)
    assert.equal((await h.api('imports', people.owner)).length, imports, 'a refused apply leaves no job behind')
    // A manager reviews Jo's record after import; undoing the import keeps that decision.
    const jo = (await h.api('history', people.owner)).find(row => row.email === 'jo.former@example.test')
    await h.api('history.accept', people.manager, { history: jo.id, note: 'Matches our 2025 paper records.' })
    await undoAll()
    const left = await h.api('history', people.owner)
    assert.deepEqual(left.map(row => row.id), [jo.id])
    assert.equal(left[0].accepted.note, 'Matches our 2025 paper records.')
    assert.ok((await h.api('imports', people.owner)).some(job => job.retained.some(item => item.target === jo.id && item.reason === 'edited')))
  })

  await agentFlows({ h, check, people, ids, publish })
} catch (error) {
  console.error(h.output().slice(-6000))
  throw error
} finally {
  await h.close()
}
