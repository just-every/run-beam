import assert from 'node:assert/strict'

export async function languageBrowserCheck(f, item) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const { mkdir } = await import('node:fs/promises'), { join } = await import('node:path')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  const overflow = []
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      await context.addCookies(f.cookies.learner.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin })))
      const page = await context.newPage()
      const screenshot = async (name, evidenceWidth = width) => {
        assert.equal(await page.locator('html').getAttribute('lang'), 'es-US')
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) overflow.push(`${name} at ${width}`)
        await page.screenshot({ path: join(evidence, `${evidenceWidth}-language-${name}.png`), fullPage: true, mask: [page.locator('a[href^="/verify/"]')] })
      }
      if (item.errorPages) {
        for (const [name, path] of item.errorPages) {
          await page.goto(f.h.origin + path)
          await page.getByRole('alert').waitFor()
          await screenshot(`error-${name}`)
        }
        await context.close(); continue
      }
      if (item.signedPath) {
        await page.goto(f.h.origin + item.signedPath)
        await page.getByRole('heading', { name: 'Decisión', exact: true }).waitFor()
        await screenshot('acknowledgment-signed'); await context.close(); continue
      }
      await page.goto(f.h.origin + '/app/learning'); await page.getByRole('heading', { name: 'Mi aprendizaje', exact: true }).waitFor(); await screenshot('learning')
      await page.goto(`${f.h.origin}/app/learn/${item.assignment}`); await page.getByText(/No hay una versión revisada en español/).waitFor(); await screenshot('course')
      await page.goto(`${f.h.origin}/app/learn/${item.assignment}/lessons/${item.lesson}`); await page.getByText('USER CONTENT: My learning. Use clean tools.').waitFor(); await screenshot('lesson')
      if (width === 1440) await page.getByRole('button', { name: 'Marcar como completada', exact: true }).click()
      await page.goto(`${f.h.origin}/app/learn/${item.assignment}/quiz`)
      await page.getByRole('button', { name: 'Enviar respuestas', exact: true }).waitFor(); await screenshot('quiz')
      if (width === 1440) {
        await page.getByLabel('Clean', { exact: true }).check()
        await page.getByRole('button', { name: 'Enviar respuestas', exact: true }).click()
      }
      const record = await f.api('learner', 'records/me'), certificate = record.completions.find(row => row.course === item.course).certificate
      const verification = await f.api('learner', 'certificate.link', { certificate })
      await page.goto(`${f.h.origin}/app/certificates/${certificate}?link=${verification.id}`); await page.getByText(/Certificado de finalización/).waitFor(); await screenshot('certificate')
      await page.locator(`a[href="/verify/${verification.id}"]`).click()
      await page.getByRole('link', { name: 'Español (EE. UU.)', exact: true }).click()
      await page.getByRole('heading', { name: 'Certificado verificado', exact: true }).waitFor(); await screenshot('verification')
      const completed = await f.api('learner', `assignments/${item.assignment}`)
      await page.goto(`${f.h.origin}/app/attempts/${completed.attempts[0].id}`); await screenshot('attempt')
      for (const [name, path, spanish] of item.peripheral.pages) {
        await page.goto(f.h.origin + path)
        await page.getByText(spanish, { exact: false }).first().waitFor()
        if (name === 'record') for (const summary of await page.locator('details > summary').all()) await summary.click()
        await screenshot(name)
      }
      await page.goto(`${f.h.origin}/app/learn/${item.peripheral.timed}/quiz`)
      if (width === 1440) {
        await page.getByRole('button', { name: 'Comenzar el cuestionario con límite de tiempo', exact: true }).waitFor(); await screenshot('timed-start')
        await page.setViewportSize({ width: 390, height: 900 }); await screenshot('timed-start', 390)
        await page.setViewportSize({ width, height: 900 })
        await page.getByRole('button', { name: 'Comenzar el cuestionario con límite de tiempo', exact: true }).click()
      }
      await page.getByRole('button', { name: 'Guardar respuestas', exact: true }).waitFor()
      await screenshot('timed-running')
      await page.goto(f.h.origin + '/app/learning'); await screenshot('learning-peripheral-cards')
      await context.close()
      console.log(`PASS language learner/core/timed/peripheral ${width}`)
    }
    assert.deepEqual(overflow, [], 'learner screens fit each viewport')
  } finally { await browser.close() }
}
