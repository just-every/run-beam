import { queuedEntrypoint } from '@runeditrun/rer/queued-entry'
const queued = await queuedEntrypoint(import.meta.url, 'test:flows'); if (queued !== null) process.exit(queued)
// Beam's contract clauses, each exercised through public HTTP doors against
// the built Worker with real local D1 and R2. Mail is captured at the Resend edge.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pdf, procedureV1, procedureV2 } from './fixtures.mjs'
import { file, harness } from './harness.mjs'
import { agentFlows } from './agent-flows.mjs'
import { importFlows, importTrust } from './import-flows.mjs'

const trust = importTrust()
const h = await harness({bindings: trust.bindings})
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
    // The owner sets teams and who manages them (ORG-004); Tom manages the front desk.
    await h.api('team.create', people.manager, { name: 'Front desk' }, 403)
    ids.team = (await h.api('team.create', people.owner, { name: 'Front desk' })).id
    await h.api('team.members', people.owner, { team: ids.team, members: [ids.sam, ids.lee] })
    await h.api('team.managers', people.owner, { team: ids.team, members: [ids.manager] })
    const leads = (await h.api('team.create', people.owner, { name: 'Clinic leads' })).id
    await h.api('team.members', people.owner, { team: leads, members: [ids.author] })
    await h.api('team.managers', people.owner, { team: leads, members: [ids.manager] })
    // Removing access ends the person's sessions; restoring it needs a fresh sign-in.
    await h.api('person.access', people.owner, { member: ids.lee, status: 'inactive' })
    await h.api('me', people.lee, undefined, 401)
    await h.api('person.access', people.owner, { member: ids.lee, status: 'active' })
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
    assert.match(detail.scoringRule, /every choice, blank, position or pair is correct/)
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
    const forged = await h.fetch('/api/beam/business.configure', { method: 'POST', headers: { cookie: people.owner, origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Taken', timezone: 'UTC' }) })
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
    await h.api('notice.decide', people.reviewer, { notice: notice.id, decision: 'draft_updated', note: 'The fridge step changed; revising.', nextReviewOn: '2031-06-30', retraining: 'none' })
    assert.ok(!(await h.api('queues', people.reviewer)).notices.length)
  })

  await check('BEAM-15', async () => importFlows({h, people, ids, trust}))

  await check('AUTHOR-004', async () => {
    const course = await h.api('course.create', people.author, { title: 'Closing the clinic', summary: 'How we close.', reviewer: ids.reviewer })
    let draftVersion = course.draftVersion
    const edit = async (action, fields) => { draftVersion = (await h.api(action, people.author, { course: course.id, draftVersion, ...fields })).draftVersion }
    await edit('course.lesson', { title: 'Lock up', body: 'Lock the doors.\nSet the alarm.', sources: [ids.sourceV1] })
    await edit('course.lesson', { title: 'Cash', body: 'Count the till.', sources: [] })
    await edit('course.question', { prompt: 'What comes last?', choices: 'Set the alarm\nCount the till', correct: '1' })
    await edit('course.assessment', { passPercent: 100, maxAttempts: 2 })
    const first = await h.api('course.submit', people.author, { course: course.id, draftVersion })
    await publish(first.id)
    // Lee completes revision 1 before anything changes.
    const assigned = (await h.api('assignment.create', people.manager, { course: course.id, learners: [ids.lee], dueDate: '2030-03-01' })).created[0]
    for (const lesson of await lessonsOf(people.lee, assigned)) await h.api('lesson.complete', people.lee, { assignment: assigned, lesson: lesson.id })
    const [question] = (await h.api(`assignments/${assigned}`, people.lee)).quiz.questions
    const passed = await h.api('quiz.submit', people.lee, { assignment: assigned, [`q_${question.id}`]: ['0'] })
    assert.ok(passed.completion)
    const before = (await h.api('records/me', people.lee)).completions.find(row => row.course === course.id)
    // Revision 2 rewrites a line, drops a lesson, adds one citing procedure v2, and changes the quiz and rules.
    const sourceV2 = (await h.api('sources', people.author)).find(row => row.id === ids.source).versions[1].id
    const draft = (await h.api(`courses/${course.id}`, people.author)).draft
    await edit('course.lesson', { lesson: draft.lessons[0].id, title: 'Lock up', body: 'Lock the doors.\nSet the alarm and wait for the beep.', sources: [ids.sourceV1] })
    await edit('course.lesson.remove', { lesson: draft.lessons[1].id })
    await edit('course.lesson', { title: 'Fridge check', body: 'Record the fridge temperature.', sources: [sourceV2] })
    await edit('course.question', { question: draft.questions[0].id, prompt: 'What do you do last?', choices: 'Set the alarm\nCount the till', correct: '1' })
    await edit('course.question', { prompt: 'Where is the temperature written?', choices: 'Fridge log\nWhiteboard', correct: '1' })
    await edit('course.assessment', { passPercent: 80, maxAttempts: 2, drawCount: 1, shuffle: '1', feedback: 'final' })
    const second = await h.api('course.submit', people.author, { course: course.id, draftVersion })
    await publish(second.id)
    const compared = await h.api(`compare?from=${first.id}&to=${second.id}`, people.author)
    assert.equal(compared.changed, true)
    assert.deepEqual(compared.lessons.map(row => [row.change, (row.to ?? row.from).title]), [['changed', 'Lock up'], ['removed', 'Cash'], ['added', 'Fridge check']])
    assert.deepEqual(compared.lessons[0].body.lines.filter(line => line.op !== 'same'), [{ op: 'del', text: 'Set the alarm.' }, { op: 'add', text: 'Set the alarm and wait for the beep.' }])
    assert.deepEqual(compared.lessons[2].sources.added, [sourceV2])
    assert.deepEqual(compared.assessment.questions.map(row => [row.change, row.prompt.from, row.prompt.to]), [['changed', 'What comes last?', 'What do you do last?'], ['added', null, 'Where is the temperature written?']])
    assert.deepEqual(compared.assessment.rules.find(rule => rule.name === 'passPercent'), { name: 'passPercent', from: 100, to: 80, changed: true })
    assert.deepEqual(['drawCount', 'shuffle', 'feedback'].map(name => compared.assessment.rules.find(rule => rule.name === name)), [{ name: 'drawCount', from: null, to: 1, changed: true }, { name: 'shuffle', from: false, to: true, changed: true }, { name: 'feedback', from: 'attempt', to: 'final', changed: true }])
    await h.api(`compare?from=${first.id}&to=${ids.openingRev2}`, people.author, undefined, 400)
    await h.api(`compare?from=${first.id}&to=${second.id}`, people.lee, undefined, 403)
    const comparePage = await (await h.raw(`/app/courses/${course.id}/compare?from=${first.id}&to=${second.id}`, { cookie: people.author })).text()
    assert.ok(comparePage.includes('<del>− Set the alarm.</del>') && comparePage.includes('Restore revision 1 into the draft'))
    // Source versions compare by their recorded facts and, for text, line by line.
    const sourceDiff = await h.api(`source-compare?from=${ids.sourceV1}&to=${sourceV2}`, people.reviewer)
    assert.deepEqual([sourceDiff.sameBytes, sourceDiff.from.sha256, sourceDiff.to.number], [false, sha(procedureV1), 2])
    assert.deepEqual(sourceDiff.text.lines.filter(line => line.op !== 'same'), [{ op: 'del', text: 'Opening procedure v1' }, { op: 'add', text: 'Opening procedure v2' }, { op: 'del', text: '2. Check the fridge log.' }, { op: 'add', text: '2. Check the fridge log and record the temperature.' }])
    const sourcePage = await (await h.raw(`/app/sources/${ids.source}/compare`, { cookie: people.author })).text()
    assert.ok(sourcePage.includes('<ins>+ 2. Check the fridge log and record the temperature.</ins>'))
    // Restore revision 1 into the draft through course history; a stale or non-author restore is refused.
    await h.api('course.restore', people.manager, { course: course.id, draftVersion, revision: first.id }, 403)
    await h.api('course.restore', people.author, { course: course.id, draftVersion: draftVersion - 1, revision: first.id }, 409)
    assert.ok((await (await h.raw(`/app/courses/${course.id}`, { cookie: people.author })).text()).includes('Restore into draft'))
    const restored = await h.submit('course.restore', people.author, { course: course.id, draftVersion, revision: first.id }, `/app/courses/${course.id}`)
    assert.equal(restored.searchParams.get('notice'), 'Saved.')
    const detail = await h.api(`courses/${course.id}`, people.author)
    assert.deepEqual(detail.draft.lessons.map(lesson => [lesson.title, lesson.body, lesson.sources]), [['Lock up', 'Lock the doors.\nSet the alarm.', [ids.sourceV1]], ['Cash', 'Count the till.', []]])
    assert.deepEqual([detail.draft.questions.map(row => row.prompt), detail.draft.passPercent], [['What comes last?'], 100])
    assert.equal(detail.publishedRevision, second.id, 'restoring changes only the draft')
    const third = await h.api('course.submit', people.author, { course: course.id, draftVersion: detail.draftVersion })
    await publish(third.id)
    assert.equal((await h.api(`compare?from=${first.id}&to=${third.id}`, people.author)).changed, false)
    assert.deepEqual((await h.api(`courses/${course.id}`, people.reviewer)).revisions.map(row => [row.number, row.state]), [[3, 'published'], [2, 'superseded'], [1, 'superseded']])
    assert.deepEqual((await h.api(`revisions/${second.id}`, people.reviewer)).lessons.map(lesson => lesson.title), ['Lock up', 'Fridge check'])
    // Lee's completion and certificate stay bound to revision 1.
    const after = (await h.api('records/me', people.lee)).completions.find(row => row.course === course.id)
    assert.deepEqual(after, before)
    assert.equal(after.revision, first.id)
    assert.equal((await h.api(`certificates/${after.certificate}`, people.lee)).revision, 1)
    assert.equal((await h.api(`assignments/${assigned}`, people.lee)).assignment.status, 'completed')
    // A revision that changes only the draw, order and feedback settings is a change, and restoring it brings them back.
    const settings = await h.api('course.assessment', people.author, { course: course.id, draftVersion: (await h.api(`courses/${course.id}`, people.author)).draftVersion, passPercent: 100, maxAttempts: 2, drawCount: 1, shuffle: '1', feedback: 'score' })
    const fourth = await h.api('course.submit', people.author, { course: course.id, draftVersion: settings.draftVersion })
    await publish(fourth.id)
    const settingsOnly = await h.api(`compare?from=${third.id}&to=${fourth.id}`, people.author)
    assert.equal(settingsOnly.changed, true)
    assert.deepEqual([...settingsOnly.lessons, ...settingsOnly.assessment.questions].map(row => row.change), ['same', 'same', 'same'])
    assert.deepEqual(settingsOnly.assessment.rules.filter(rule => rule.changed).map(rule => [rule.name, rule.from, rule.to]), [['drawCount', null, 1], ['shuffle', false, true], ['feedback', 'attempt', 'score']])
    assert.ok((await (await h.raw(`/app/courses/${course.id}/compare?from=${third.id}&to=${fourth.id}`, { cookie: people.author })).text()).includes('score only'))
    await h.api('course.restore', people.author, { course: course.id, draftVersion: (await h.api(`courses/${course.id}`, people.author)).draftVersion, revision: third.id })
    const back = await h.api(`courses/${course.id}`, people.author)
    assert.deepEqual([back.draft.drawCount, back.draft.shuffle, back.draft.feedback], [null, false, 'attempt'])
  })

  await check('LEARN-010', async () => {
    const policyV1 = 'Phone use policy v1\n\nPhones stay in lockers during treatments.\n'
    const policy = await h.api('source.create', people.author, { title: 'Phone use policy', licence: 'owned', licenceEvidence: 'Written by the practice manager.', reviewer: ids.reviewer, provenance: 'Policy binder', file: file('phones.txt', policyV1) })
    await h.api('acknowledgment.request', people.sam, { source: policy.id, kind: 'acknowledgment', learners: [ids.sam] }, 403)
    const asked = await h.api('acknowledgment.request', people.manager, { source: policy.id, kind: 'acknowledgment', learners: [ids.sam] })
    const signing = await h.api('acknowledgment.request', people.manager, { source: policy.id, kind: 'signature', learners: [ids.lee] })
    assert.deepEqual([asked.sourceVersion, asked.created.length, signing.created.length], [policy.versionId, 1, 1])
    const [samAck] = asked.created, [leeAck] = signing.created
    const completionsBefore = (await h.api('records/me', people.sam)).completions
    // Signing needs the document opened first, then an explicit statement of intent.
    await h.api('acknowledgment.decide', people.sam, { acknowledgment: samAck, decision: 'sign', agree: 'yes' }, 409)
    const opened = await h.raw(`/app/acknowledgments/${samAck}/document`, { cookie: people.sam })
    assert.equal(sha(Buffer.from(await opened.arrayBuffer())), sha(policyV1))
    await h.api('acknowledgment.decide', people.sam, { acknowledgment: samAck, decision: 'sign' }, 400)
    const signed = await h.submit('acknowledgment.decide', people.sam, { acknowledgment: samAck, decision: 'sign', agree: 'yes' }, `/app/acknowledgments/${samAck}`)
    assert.equal(signed.searchParams.get('notice'), 'Saved.')
    await h.api('acknowledgment.decide', people.sam, { acknowledgment: samAck, decision: 'decline', reason: 'Changed my mind' }, 409)
    const samView = await h.api(`acknowledgments/${samAck}`, people.sam)
    assert.deepEqual([samView.state, samView.sourceVersion, samView.identityMethod, samView.document.sha256], ['signed', policy.versionId, 'emailed sign-in link', sha(policyV1)])
    assert.ok(samView.viewedAt && samView.decidedAt >= samView.viewedAt)
    assert.match(samView.intent, /read and understood “Phone use policy” version 1/)
    // An electronic signature must be the signer's own name; Lee declines instead.
    await h.raw(`/app/acknowledgments/${leeAck}/document`, { cookie: people.lee })
    await h.api('acknowledgment.decide', people.lee, { acknowledgment: leeAck, decision: 'sign', agree: 'yes', signature: 'Sam Lee' }, 400)
    await h.api('acknowledgment.decide', people.lee, { acknowledgment: leeAck, decision: 'decline', reason: 'I need the on-call exception explained first.' })
    await h.api(`acknowledgments/${samAck}`, people.lee, undefined, 404)
    assert.equal((await h.raw(`/app/acknowledgments/${samAck}/evidence`, { cookie: people.lee })).status, 404)
    const managed = (await h.api('acknowledgments', people.manager)).managed.filter(row => row.source === policy.id)
    assert.deepEqual(managed.map(row => [row.learnerName, row.kind, row.state]).sort(), [['Lee Park', 'signature', 'declined'], ['Sam Lee', 'acknowledgment', 'signed']])
    assert.equal(managed.find(row => row.state === 'declined').declineReason, 'I need the on-call exception explained first.')
    // Downloadable evidence names the exact document, intent, signer, time and identity method.
    const evidence = await h.raw(`/app/acknowledgments/${samAck}/evidence`, { cookie: people.manager })
    assert.match(evidence.headers.get('content-disposition'), /attachment/)
    const record = await evidence.text()
    for (const part of [`Document SHA-256: ${sha(policyV1)}`, 'Person: Sam Lee <sam@example.test>', 'Identity method: emailed sign-in link', 'Intent: I have read and understood']) assert.ok(record.includes(part), part)
    // An acknowledgment is not assessed learning.
    assert.deepEqual((await h.api('records/me', people.sam)).completions, completionsBefore)
    // A revised policy asks again separately; the earlier decisions stay as they were.
    const v2 = await h.api('source.version', people.author, { source: policy.id, provenance: 'Revised for on-call staff', file: file('phones.txt', 'Phone use policy v2\n\nOn-call staff keep phones on silent.\n') })
    const samMine = (await h.api('acknowledgments', people.sam)).mine.filter(row => row.source === policy.id)
    assert.deepEqual(samMine.map(row => [row.versionNumber, row.state]), [[2, 'open'], [1, 'signed']])
    assert.deepEqual([samMine[0].sourceVersion, samMine[0].previous, samMine[0].kind], [v2.id, samAck, 'acknowledgment'])
    const leeMine = (await h.api('acknowledgments', people.lee)).mine.filter(row => row.source === policy.id)
    assert.deepEqual(leeMine.map(row => [row.versionNumber, row.kind, row.state]), [[2, 'signature', 'open'], [1, 'signature', 'declined']])
    assert.ok((await (await h.raw('/app/learning', { cookie: people.sam })).text()).includes(`/app/acknowledgments/${samMine[0].id}`))
    assert.ok((await (await h.raw(`/app/acknowledgments/${samAck}/evidence`, { cookie: people.sam })).text()).includes(`Document SHA-256: ${sha(policyV1)}`))
  })

  await agentFlows({ h, check, people, ids, publish })
} finally {
  await h.close()
}
