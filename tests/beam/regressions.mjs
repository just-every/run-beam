// Focused public HTTP flows (assessor revocation, exact offline revision,
// renewal provenance, resets, access windows, timed assessments, question types, course retirement and copies, announcements, transcripts, blockers and exceptions, follow-on rules, inactivity deactivation, the learner catalog, live sessions, scoped agent preparation, delegated administration, course-scoped authoring, team-scoped managers, custom roles, auditors, the decision audit, view as) with real isolated D1/R2.
// --only=NAME runs the checks whose name starts with NAME.
import { fixture } from './regression-fixture.mjs'
import { learningChecks } from './regression-learning.mjs'
import { agentCheck } from './regression-agent.mjs'
import { timedCheck } from './regression-timing.mjs'
import { adminCheck, courseScopeCheck } from './regression-admin.mjs'
import { auditorCheck, customRoleCheck, managersCheck } from './regression-managers.mjs'
import { auditCheck } from './regression-audit.mjs'
import { viewAsCheck } from './regression-view.mjs'
import { questionTypesCheck } from './regression-questions.mjs'
import { estateCheck } from './regression-estate.mjs'
import { announcementCheck } from './regression-notices.mjs'
import { transcriptCheck } from './regression-transcript.mjs'
import { exceptionsCheck } from './regression-exceptions.mjs'
import { automationCheck } from './regression-automation.mjs'
import { inactivityCheck } from './regression-inactivity.mjs'
import { catalogCheck } from './regression-catalog.mjs'
import { liveCheck } from './regression-live.mjs'
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice('--only='.length) ?? ''
const f = await fixture()
try {
  for (const [name, check] of [...learningChecks, ['LEARN-018 timed assessments', timedCheck], ['LEARN-015 fill-in, ordering and matching questions', questionTypesCheck], ['AUTHOR-005 organize and reuse the course estate', estateCheck], ['NOTICE-006 announcements with private replies', announcementCheck], ['REPORT-003 learner transcripts', transcriptCheck], ['AUTO-006 blockers, deferrals and exemptions', exceptionsCheck], ['AUTO-005 follow-on rules', automationCheck], ['ORG-007 self-service catalog', catalogCheck], ['LIVE-001 classroom and blended sessions', liveCheck], ['BEAM-14 scoped preparation and human publication', agentCheck], ['ORG-002 delegated administration', adminCheck], ['ORG-003 course-scoped authors and reviewers', courseScopeCheck], ['ORG-004 team-scoped managers', managersCheck], ['ORG-010 custom administrator roles', customRoleCheck], ['ORG-005 read-only auditors', auditorCheck], ['OPS-001 searchable audit', auditCheck], ['ORG-012 read-only view as', viewAsCheck], ['AUTO-007 inactivity deactivation', inactivityCheck]].filter(([name]) => name.startsWith(only))) {
    await check(f)
    console.log(`PASS ${name}`)
  }
} finally {
  await f.h.close()
}
