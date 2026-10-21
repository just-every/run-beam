import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

// OPS-007: exercise the documented operator command, never its implementation.
export function configurationCheck(vars) {
  const run = input => {
    const result = spawnSync(process.execPath, ['scripts/diagnose-configuration.mjs'], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' })
    assert.equal(result.stderr, '', 'OPS-007: diagnostics never dump errors or input to stderr')
    return { code: result.status, output: result.stdout, report: JSON.parse(result.stdout) }
  }
  const valid = { ...vars, AUTH_ORIGIN: 'https://training.example.test' }
  const healthy = run(valid)
  assert.equal(healthy.code, 0, 'OPS-007: valid hosted settings pass offline checks')
  assert.equal(healthy.report.issues.length, 0)
  const planted = randomBytes(32).toString('hex')
  for (const [setting, value] of [
    ['AUTH_ORIGIN', `https://user:${planted}@training.example.test/private`],
    ['OWNER_EMAIL', planted], ['SESSION_SECRET', planted.slice(0, 12)], ['SETUP_TOKEN', planted.slice(0, 12)],
    ['MAIL_PROVIDER', planted], ['MAIL_FROM', `${planted}\r\nBcc: other@example.test`], ['MAIL_API_KEY', `${planted} bad`],
    ['MAIL_ACCOUNT_ID', planted.slice(0, 12)], ['AUTH_LOCAL', planted],
  ]) {
    const input = { ...valid, [setting]: value, ...(setting === 'MAIL_ACCOUNT_ID' ? { MAIL_PROVIDER: 'cloudflare' } : {}) }
    const bad = run(input)
    assert.equal(bad.code, 1, `OPS-007: invalid ${setting} fails`)
    assert.ok(bad.report.issues.some(issue => issue.setting === setting && issue.action.length > 20), `OPS-007: ${setting} has an actionable diagnostic`)
    assert.ok(!bad.output.includes(value), `OPS-007: ${setting} value stays private`)
    assert.ok([vars.SESSION_SECRET, vars.SETUP_TOKEN, vars.MAIL_API_KEY].every(secret => !bad.output.includes(secret)), 'OPS-007: unrelated secrets stay private')
    delete input[setting]
    if (setting !== 'AUTH_LOCAL' && setting !== 'SETUP_TOKEN') {
      const missing = run(input)
      assert.equal(missing.code, 1, `OPS-007: missing ${setting} fails`)
      assert.ok(missing.report.issues.some(issue => issue.setting === setting), `OPS-007: missing ${setting} is named`)
    }
    const corrected = run(setting === 'MAIL_ACCOUNT_ID' ? { ...valid, MAIL_PROVIDER: 'cloudflare', MAIL_ACCOUNT_ID: randomBytes(16).toString('hex') } : valid)
    assert.equal(corrected.code, 0, `OPS-007: correcting ${setting} clears the failure`)
  }
  for (const provider of ['resend', 'sendgrid', 'cloudflare']) {
    assert.equal(run({ ...valid, MAIL_PROVIDER: provider, ...(provider === 'cloudflare' ? { MAIL_ACCOUNT_ID: randomBytes(16).toString('hex') } : {}) }).code, 0, 'OPS-007: supported provider syntax is accepted without sending mail')
  }
  const local = { ...valid, AUTH_LOCAL: 'true', AUTH_ORIGIN: 'http://127.0.0.1:4000', MAIL_PROVIDER: 'development' }
  delete local.MAIL_API_KEY; delete local.MAIL_FROM; delete local.SETUP_TOKEN
  assert.equal(run(local).code, 0, 'OPS-007: local development and claimed installs do not require unused secrets')
  const malformed = run(`{"SESSION_SECRET":"${planted}",`)
  assert.equal(malformed.code, 1)
  assert.equal(malformed.report.status, 'invalid_input')
  assert.ok(!malformed.output.includes(planted), 'OPS-007: malformed input never echoes credentials')
  assert.equal(run('[]').code, 1)
  assert.equal(run('x'.repeat(65 * 1024)).code, 1)
  console.log('PASS OPS-007 offline configuration command: invalid/missing settings, secret-safe actions and correction')
}
