// Four focused public HTTP flows (assessor revocation, exact offline revision,
// renewal provenance, scoped agent preparation) with real isolated D1/R2.
// --only=NAME runs the checks whose name starts with NAME.
import { fixture } from './regression-fixture.mjs'
import { learningChecks } from './regression-learning.mjs'
import { agentCheck } from './regression-agent.mjs'
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice('--only='.length) ?? ''
const f = await fixture()
try {
  for (const [name, check] of [...learningChecks, ['BEAM-14 scoped preparation and human publication', agentCheck]].filter(([name]) => name.startsWith(only))) {
    await check(f)
    console.log(`PASS ${name}`)
  }
} catch (error) {
  console.error(f.h.output().slice(-6000))
  throw error
} finally {
  await f.h.close()
}
