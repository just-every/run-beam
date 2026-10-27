import assert from 'node:assert/strict'
import { file } from './harness.mjs'
import { portalThemeBrowserCheck } from './portal-theme-browser.mjs'

export async function portalThemeCheck(f) {
  const { api, h, cookies } = f
  const { syntheticImage } = await import('./fixtures.mjs')
  const settings = { primary: '#173f5f', accent: '#325f8b', signinHeading: 'Sierra Lakes training', signinText: 'Use your workplace identity.', senderName: 'Sierra Lakes Learning' }
  await api('manager', 'theme.save', settings, 403)
  await api('learner', 'theme', undefined, 403)
  const saved = await api('owner', 'theme.save', { ...settings, logo: file('logo.png', syntheticImage), favicon: file('favicon.png', syntheticImage) })
  for (const [name, value] of Object.entries(settings)) assert.equal(saved[name], value, `saved ${name}`)
  assert.equal(saved.logo.mediaType, 'image/png')
  assert.equal(saved.favicon.mediaType, 'image/png')
  await api('learner', 'theme.save', settings, 403)
  assert.equal((await h.raw('/api/beam/theme.save', { body: settings })).status, 401)
  for (const name of ['primary', 'accent']) {
    const response = await h.raw('/api/beam/theme.save', { cookie: cookies.owner, body: { ...settings, [name]: '#eeeeee' } })
    assert.equal(response.status, 400)
    assert.deepEqual((await response.json()).detail.pair, `${name} and white`)
  }
  await api('owner', 'theme.save', { ...settings, primary: 'red;display:none' }, 400)
  await api('owner', 'theme.save', { ...settings, senderName: 'Injected\r\nBcc: stranger@example.test' }, 400)
  await api('owner', 'theme.save', { ...settings, logo: file('active.svg', '<svg onload="alert(1)"></svg>') }, 400)
  const damaged = Buffer.from(syntheticImage); damaged[29] ^= 1
  await api('owner', 'theme.save', { ...settings, logo: file('damaged.png', damaged) }, 400)
  assert.equal((await api('owner', 'theme')).version, saved.version, 'invalid saves leave the admitted theme intact')
  const css = await h.raw('/beam-theme.css')
  assert.equal(css.status, 200)
  assert.match(await css.text(), /background:#173f5f/)
  for (const path of ['/beam-theme/logo', '/beam-theme/favicon']) {
    const response = await h.raw(path)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), syntheticImage)
    assert.equal((await h.raw(path, { method: 'HEAD' })).status, 200)
    assert.equal((await h.raw(path, { body: {} })).status, 405)
  }
  for (const [role, path] of [['owner', '/app/business'], ['learner', '/app/learning'], ['manager', '/app/manage']]) {
    const response = await h.raw(path, { cookie: cookies[role] })
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /href="\/beam-theme.css"/)
    assert.match(html, /src="\/beam-theme\/logo"/)
    assert.match(html, /href="\/beam-theme\/favicon"/)
    assert.ok(!response.headers.get('content-security-policy').includes('unsafe-inline'))
  }
  const signin = await (await h.raw('/signin')).text()
  assert.ok(signin.includes(settings.signinHeading) && signin.includes(settings.signinText))
  assert.match(signin, /src="\/beam-theme\/logo"/)
  assert.equal((await h.raw('/api/beam/people')).status, 401, 'public brand images confer no learning authority')
  await h.signIn('learner@example.test')
  const signinMail = h.mails.at(-1)
  assert.equal(signinMail.from, 'Sierra Lakes Learning <auth@example.test>')
  assert.ok(signinMail.html.includes('#173f5f') && signinMail.html.includes('#325f8b') && signinMail.html.includes('/beam-theme/logo'), 'ordinary sign-in mail uses the admitted theme')
  const c = await f.course('Portal theme safety'), assignment = await f.assign(c)
  await h.db.prepare('UPDATE beam_assignments SET due_at=? WHERE id=?').bind(Date.now() - 3600000, assignment).run()
  await api('owner', 'escalation.policy', { version: 0, enabled: true, reminderHours: 0, managerHours: 48, fallbackHours: 72 })
  await api('owner', 'escalation.run', {})
  const mail = h.mails.findLast(value => value.to.includes('learner@example.test') && value.text?.includes(c.title || 'Portal theme safety'))
  assert.ok(mail)
  assert.equal(mail.from, 'Sierra Lakes Learning <auth@example.test>')
  assert.ok(mail.html.includes('#173f5f') && mail.html.includes('#325f8b') && mail.html.includes('/beam-theme/logo'))
  assert.ok(mail.text.includes(`/app/learn/${assignment}`))
  await f.lessons(assignment)
  const certificate = (await api('learner', `records/${f.ids.learner}`)).completions.find(value => value.course === c.id).certificate
  const pdf = await h.raw(`/app/certificates/${certificate}.pdf`, { cookie: cookies.learner })
  assert.equal(pdf.status, 200)
  const pdfBytes = Buffer.from(await pdf.arrayBuffer())
  assert.ok(pdfBytes.toString('latin1').includes('0.090 0.247 0.373 RG'), 'certificate uses the admitted primary color')
  const { getDocumentProxy } = await import('unpdf')
  const document = await getDocumentProxy(new Uint8Array(pdfBytes))
  try {
    const page = await document.getPage(1), operators = await page.getOperatorList()
    assert.ok(operators.fnArray.includes(85), 'downloaded certificate contains a decoded employer image')
  } finally { await document.loadingTask.destroy() }
  if (process.argv.includes('--browser')) {
    const pending = await f.assign(await f.course('Pending portal learning'))
    await portalThemeBrowserCheck(f, settings, pending, certificate)
  }
}
