import assert from 'node:assert/strict'

// LEARN-002: the owner designs a template (heading, approved wording, signatory, and the fields a verification link may
// show) and names it on a course; a completion issues a certificate on it, downloadable as a tagged PDF. The learner
// creates a verification link; a visitor sees only the permitted fields; revoking it ends it. A correction issues a
// superseding certificate with a new number and keeps the original; a certificate keeps the template it was issued with.
export async function certificatesCheck(f) {
  const { api, h, cookies, course, assign, lessons } = f
  const c = await course('Food safety basics')
  assert.equal((await api('manager', 'certificate.template', { name: 'x', heading: 'x', wording: 'x', signatoryName: 'x', signatoryTitle: 'x', verifyFields: ['learner'] }, 403)).error, 'forbidden')
  assert.equal((await h.submit('certificate.template', cookies.owner, { name: 'Food safety', heading: 'Certificate of food safety training', wording: 'has completed the food safety program of', signatoryName: 'Dana Ruiz', signatoryTitle: 'Training lead', verifyFields: ['learner', 'course', 'completedOn', 'number'] }, '/app/certificate-templates')).searchParams.get('error'), null)
  const template = (await api('owner', 'certificate-templates')).find(item => item.name === 'Food safety')
  await api('owner', 'course.certificate', { course: c.id, template: template.id })
  const assignment = await assign(c)
  await lessons(assignment)
  const id = (await api('learner', 'records/me')).completions.find(row => row.course === c.id).certificate
  const issued = await api('learner', `certificates/${id}`)
  assert.deepEqual([issued.template.name, issued.current.number, issued.corrections], ['Food safety', issued.number, []])

  // The PDF: tagged, in English, titled, with the template's heading, wording and signatory.
  const pdf = async role => { const res = await h.raw(`/app/certificates/${id}.pdf`, { cookie: cookies[role] }); return { status: res.status, type: res.headers.get('content-type'), text: Buffer.from(await res.arrayBuffer()).toString('latin1') } }
  const first = await pdf('learner')
  assert.ok(first.status === 200 && first.type === 'application/pdf' && first.text.startsWith('%PDF-1.7') && first.text.trimEnd().endsWith('%%EOF'))
  for (const part of ['/StructTreeRoot', '/Lang (en-US)', '/MarkInfo << /Marked true >>', '/DisplayDocTitle true', '/S /H1', '(Certificate of food safety training)', '(has completed the food safety program of)', '(Dana Ruiz, Training lead)', `(Certificate ${issued.number})`]) assert.ok(first.text.includes(part), part)
  assert.equal((await pdf('manager')).status, 200)
  assert.equal((await pdf('other')).status, 404)

  // Only the learner creates a link; a visitor sees only the permitted fields.
  assert.equal((await api('manager', 'certificate.link', { certificate: id }, 403)).error, 'own_certificate_only')
  const made = await h.submit('certificate.link', cookies.learner, { certificate: id }, `/app/certificates/${id}?link={id}`)
  const token = made.searchParams.get('link')
  assert.ok((await (await h.raw(`${made.pathname}${made.search}`, { cookie: cookies.learner })).text()).includes(`/verify/${token}`))
  const visit = async path => { const res = await h.raw(path); return { status: res.status, text: await res.text() } }
  const seen = await visit(`/verify/${token}`)
  assert.equal(seen.status, 200)
  for (const shown of ['Certificate verified', 'learner', 'Food safety basics', issued.number]) assert.ok(seen.text.includes(shown), shown)
  for (const hidden of ['learner@example.test', 'Issued by', 'Valid until', 'Regression training']) assert.ok(!seen.text.includes(hidden), hidden)
  assert.equal((await visit('/verify/not-a-real-link-token-000000')).status, 404)

  // The person's manager revokes it; the link then says so.
  const link = (await api('learner', `certificates/${id}`)).links[0].id
  await api('manager', 'certificate.unlink', { link })
  const revoked = await visit(`/verify/${token}`)
  assert.ok(revoked.status === 410 && revoked.text.includes('This link was revoked') && !revoked.text.includes('Food safety basics'))

  // A correction supersedes with a new number and keeps the original; links and the PDF show the corrected certificate.
  assert.equal((await api('manager', 'certificate.correct', { certificate: id, learnerName: 'Lee Learner', reason: 'Legal name' }, 403)).error, 'forbidden')
  assert.equal((await h.submit('certificate.correct', cookies.owner, { certificate: id, learnerName: 'Lee Learner', reason: 'Legal name on the payroll record' }, `/app/certificates/${id}`)).searchParams.get('error'), null)
  const corrected = await api('learner', `certificates/${id}`)
  assert.deepEqual([corrected.number, corrected.learner, corrected.corrections.length, corrected.current.learner, corrected.corrections[0].reason], [issued.number, 'learner', 1, 'Lee Learner', 'Legal name on the payroll record'])
  assert.notEqual(corrected.current.number, issued.number)
  const second = (await h.submit('certificate.link', cookies.learner, { certificate: id }, `/app/certificates/${id}?link={id}`)).searchParams.get('link')
  const now = await visit(`/verify/${second}`)
  assert.ok(now.text.includes('Lee Learner') && now.text.includes(corrected.current.number) && now.text.includes('this is the current certificate'))
  assert.ok((await pdf('learner')).text.includes(`supersedes ${issued.number}`))
  const page = await (await h.raw(`/app/certificates/${id}`, { cookie: cookies.learner })).text()
  assert.ok(page.includes(`Original ${issued.number}`) && page.includes(`Superseding ${corrected.current.number}`))

  // A later template applies to later certificates only.
  await api('owner', 'certificate.template', { name: 'Food safety 2027', heading: 'Food safety certificate', wording: 'completed', signatoryName: 'Sam Ortiz', signatoryTitle: 'Operations director', verifyFields: ['number'] })
  await api('owner', 'course.certificate', { course: c.id, template: (await api('owner', 'certificate-templates')).find(item => item.name === 'Food safety 2027').id })
  assert.equal((await api('learner', `certificates/${id}`)).template.name, 'Food safety')
  const later = await assign(c)
  await lessons(later)
  const next = (await api('learner', 'records/me')).completions.find(row => row.course === c.id && row.certificate !== id).certificate
  assert.equal((await api('learner', `certificates/${next}`)).template.name, 'Food safety 2027')
}
