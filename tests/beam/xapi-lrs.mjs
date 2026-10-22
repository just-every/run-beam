// Real Apache-2.0 Yet Analytics SQL LRS distribution, never a replacement implementation.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
export async function realLrs() {
  assert.equal(process.env.BEAM_LIVE_PROOF, '1', 'Explicitly opt into the local real-LRS journey')
  const directory = process.env.BEAM_SQL_LRS_DIRECTORY
  assert.ok(directory, 'Set BEAM_SQL_LRS_DIRECTORY to the extracted official lrsql distribution')
  const java = join(directory, 'runtimes/macos/bin/java')
  await access(java); await access(join(directory, 'lrsql.jar'))
  const endpoint = 'http://127.0.0.1:18123/xapi/'
  // Refuse to use or stop a server this journey did not start.
  try { await fetch(`${endpoint}about`, { signal: AbortSignal.timeout(500) }); assert.fail('SQL LRS qualification port is already in use') } catch (error) { if (error.code === 'ERR_ASSERTION') throw error }
  const child = spawn(java, ['-Xms64m', '-Xmx256m', '-XX:ActiveProcessorCount=2', '-Dfile.encoding=UTF-8', '-server', '-cp', 'lrsql.jar', 'lrsql.sqlite.main', '--ephemeral', 'true'], { cwd: directory, stdio: 'ignore', env: { ...process.env, LRSQL_HTTP_HOST: '127.0.0.1', LRSQL_HTTP_PORT: '18123', LRSQL_SSL_PORT: '18124', LRSQL_ADMIN_USER_DEFAULT: 'synthetic-beam-1', LRSQL_ADMIN_PASS_DEFAULT: 'synthetic-beam-2', LRSQL_API_KEY_DEFAULT: 'synthetic-beam-1', LRSQL_API_SECRET_DEFAULT: 'synthetic-beam-2', LRSQL_AUTHORITY_URL: 'http://127.0.0.1:18123', LRSQL_SUPPORTED_VERSIONS: '1.0.3', LRSQL_ENABLE_STRICT_VERSION: 'true', LRSQL_LOG_LEVEL: 'WARN' } })
  const closed = once(child, 'exit')
  async function close() {
    if (child.exitCode !== null || child.signalCode) return
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    try { await closed } finally { clearTimeout(timer) }
  }
  try {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, 'Official SQL LRS exited before readiness')
      try {
        const response = await fetch(`${endpoint}about`, { headers: { authorization: `Basic ${Buffer.from('synthetic-beam-1:synthetic-beam-2').toString('base64')}`, 'x-experience-api-version': '1.0.3' }, signal: AbortSignal.timeout(1000) })
        if (response.ok && (await response.json()).version.includes('1.0.3')) return { endpoint, close }
      } catch { /* Wait for the official server to bind, not a retry of a learning write. */ }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error('Official SQL LRS did not become ready within 90 seconds')
  } catch (error) { await close(); throw error }
}
