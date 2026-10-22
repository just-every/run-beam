// Opt in outside push Verify, on the committed candidate, via _od08-env.py:
// BEAM_LIVE_PROOF=1 BEAM_EVIDENCE_DIR=<private-evidence> _od08-env.py \
// MAIL_API_KEY=TWILIO_SENDGRID_API_KEY MAIL_FROM=TWILIO_SENDGRID_FROM_EMAIL \
// TEST_MAIL_TO=TEST_MAIL_TO QA_INBOX_RECEIPT_TOKEN=QA_INBOX_RECEIPT_TOKEN \
// -- node tests/beam/live-language-mail.mjs
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { optIn, liveFixture, required, receiptFor, evidence } from './live-provider-runtime.mjs'

optIn()
const f = await liveFixture({ mail: true })
try {
  const { api, ids } = f
  const tag = `synthetic-beam-${randomUUID()}`
  // Directory email changes preserve the ordinary authenticated learner session.
  await api('owner', 'person.directory', { member: ids.learner, email: required('TEST_MAIL_TO'), language: 'es-US' })
  assert.equal((await api('learner', 'language')).language, 'es-US')
  const controls = await api('owner', 'automation-controls')
  await api('owner', 'automation.policy', { version: controls.policy.version, paused: false, quietStart: 0, quietEnd: 0, dailyLimit: 100 })
  const policy = await api('owner', 'escalation-policy')
  await api('owner', 'escalation.policy', { version: policy?.version ?? 0, enabled: true, reminderHours: 0, managerHours: 48, fallbackHours: 72 })
  const receipts = []
  for (const [language, subject] of [['es-US', 'Tienes una capacitación vencida'], ['en-US', 'Overdue learning needs attention']]) {
    if (language === 'en-US') {
      const switched = await f.h.submit('language.change', f.cookies.learner, { language }, '/app/learning')
      assert.equal(switched.searchParams.get('error'), null)
    }
    assert.equal((await api('learner', 'language')).language, language)
    const title = `${tag} ${language}`, course = await f.course(title)
    // Public assignment door supplies a real overdue instant, with no database clock edits.
    const due = new Date(Date.now() - 3_600_000)
    const assignment = (await api('manager', 'assignment.create', { course: course.id, learners: [ids.learner], dueDate: due.toISOString().slice(0, 10), dueTime: due.toISOString().slice(11, 16), timezone: 'UTC' })).created[0]
    const since = Date.now()
    const result = await api('owner', 'escalation.run', {})
    const sent = result.results.find(row => row.assignment === assignment && row.recipient === ids.learner)
    const failures = (await api('owner', 'automation-controls')).executions.filter(row => row.input.assignment === assignment).map(row => ({ outcome: row.outcome, failure: row.failure }))
    assert.equal(sent?.outcome, 'mail_accepted', JSON.stringify(failures))
    receipts.push({ language, ...await receiptFor({ since, title, subject, assignment, bodyPhrase: language === 'es-US' ? 'La capacitación se realiza durante el horario remunerado' : 'Training is paid work time' }) })
  }
  assert.notEqual(receipts[0].id, receipts[1].id, 'Language change produces a new delivered message')
  await evidence('live-language-mail', { flow: 'Spanish overdue reminder, self language switch, English overdue reminder', receipts })
  console.log('PASS live Spanish and English reminder delivery; receipt evidence saved')
} finally { await f.h.close() }
