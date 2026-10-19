// Focused public HTTP flows (assessor revocation, exact offline revision,
// renewal provenance, resets, access windows, timed assessments, scoped agent preparation, delegated administration, course-scoped authoring, team-scoped managers) with real isolated D1/R2.
// --only=NAME runs the checks whose name starts with NAME.
import { fixture } from './regression-fixture.mjs'
import { learningChecks } from './regression-learning.mjs'
import { agentCheck } from './regression-agent.mjs'
import { timedCheck } from './regression-timing.mjs'
import { adminCheck, courseScopeCheck } from './regression-admin.mjs'
import { managersCheck } from './regression-managers.mjs'
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice('--only='.length) ?? ''
const f = await fixture()
try {
  for (const [name, check] of [...learningChecks, ['LEARN-018 timed assessments', timedCheck], ['BEAM-14 scoped preparation and human publication', agentCheck], ['ORG-002 delegated administration', adminCheck], ['ORG-003 course-scoped authors and reviewers', courseScopeCheck], ['ORG-004 team-scoped managers', managersCheck]].filter(([name]) => name.startsWith(only))) {
    await check(f)
    console.log(`PASS ${name}`)
  }
} finally {
  await f.h.close()
}
