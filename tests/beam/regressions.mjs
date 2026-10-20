import { dataExportCheck } from './regression-data-export.mjs'
import { diagnosisCheck } from './regression-diagnosis.mjs'
// Focused public HTTP flows (assessor revocation, exact offline revision,
// renewal provenance, resets, access windows, timed assessments, question types, question banks with written answers and surveys, GIFT and Aiken bank import and export, course retirement and copies, moving learners to a published fix, coauthoring and learner feedback, announcements, transcripts, blockers and exceptions, follow-on rules, inactivity deactivation, the learner catalog, live sessions with seats, waitlists, attendance and instructors, external certificates, certificate templates and verification, the employee directory, dynamic audiences, bulk roster changes, relative due dates, recognition, lesson discussions, content upkeep and review escalation, skills and recommended paths, US employer defaults, scoped agent preparation, delegated administration, course-scoped authoring, team-scoped managers, custom roles, auditors, the decision audit, view as) with real isolated D1/R2.
// --only=NAME runs the checks whose name starts with NAME.
import { dashboardCheck } from './regression-dashboards.mjs'
import { fixture } from './regression-fixture.mjs'
import { learningChecks } from './regression-learning.mjs'
import { agentCheck } from './regression-agent.mjs'
import { timedCheck } from './regression-timing.mjs'
import { adminCheck, courseScopeCheck } from './regression-admin.mjs'
import { auditorCheck, customRoleCheck, managersCheck } from './regression-managers.mjs'
import { auditCheck } from './regression-audit.mjs'
import { viewAsCheck } from './regression-view.mjs'
import { questionBankCheck, questionTypesCheck } from './regression-questions.mjs'
import { estateCheck } from './regression-estate.mjs'
import { announcementCheck, notificationRulesCheck } from './regression-notices.mjs'
import { transcriptCheck } from './regression-transcript.mjs'
import { exceptionsCheck } from './regression-exceptions.mjs'
import { automationCheck, automationControlsCheck } from './regression-automation.mjs'
import { inactivityCheck } from './regression-inactivity.mjs'
import { catalogCheck } from './regression-catalog.mjs'
import { liveCheck } from './regression-live.mjs'
import { seatsCheck } from './regression-seats.mjs'
import { attendanceCheck } from './regression-attendance.mjs'
import { movesCheck } from './regression-moves.mjs'
import { collabCheck } from './regression-collab.mjs'
import { instructorsCheck } from './regression-instructors.mjs'
import { externalCheck } from './regression-external.mjs'
import { certificatesCheck } from './regression-certificates.mjs'
import { directoryCheck } from './regression-directory.mjs'
import { bankImportCheck } from './regression-bank.mjs'
import { audiencesCheck } from './regression-audiences.mjs'
import { rosterCheck } from './regression-roster.mjs'
import { dueDatesCheck } from './regression-due.mjs'
import { recognitionCheck } from './regression-recognition.mjs'
import { discussionsCheck } from './regression-discussions.mjs'
import { upkeepCheck } from './regression-upkeep.mjs'
import { skillsCheck } from './regression-skills.mjs'
import { usEmployerCheck } from './regression-us.mjs'
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice('--only='.length) ?? ''
const f = await fixture()
try {
  for (const [name, check] of [...learningChecks, ['OPS-002 portable learning data', async () => { const isolated = await fixture(); try { await dataExportCheck(isolated) } finally { await isolated.h.close() } }], ['AGENT-002 comparative error diagnosis', diagnosisCheck], ['REPORT-002 saved dashboards and restricted sharing', dashboardCheck], ['LEARN-018 timed assessments', timedCheck], ['LEARN-015 fill-in, ordering and matching questions', questionTypesCheck], ['LEARN-001 question banks, written answers and surveys', questionBankCheck], ['AUTHOR-005 organize and reuse the course estate', estateCheck], ['NOTICE-006 announcements with private replies', announcementCheck], ['NOTICE-005 in-app completion notification rules', async () => { const isolated = await fixture(); try { await notificationRulesCheck(isolated) } finally { await isolated.h.close() } }], ['REPORT-003 learner transcripts', transcriptCheck], ['AUTO-006 blockers, deferrals and exemptions', exceptionsCheck], ['AUTO-005 follow-on rules', automationCheck], ['AUTO-008 controlled automation', automationControlsCheck], ['ORG-007 self-service catalog', catalogCheck], ['LIVE-001 classroom and blended sessions', liveCheck], ['LIVE-002 seats and waitlists', seatsCheck], ['LIVE-003 session attendance and amendments', attendanceCheck], ['ORG-005 time-limited instructors', instructorsCheck], ['AUTHOR-010 moving learners to a published fix', movesCheck], ['AUTHOR-003 coauthoring, comments and learner feedback', collabCheck], ['BEAM-14 scoped preparation and human publication', agentCheck], ['ORG-002 delegated administration', adminCheck], ['ORG-003 course-scoped authors and reviewers', courseScopeCheck], ['ORG-004 team-scoped managers', managersCheck], ['ORG-010 custom administrator roles', customRoleCheck], ['ORG-005 read-only auditors', auditorCheck], ['OPS-001 searchable audit', auditCheck], ['ORG-012 read-only view as', viewAsCheck], ['LEARN-002 certificate templates, PDFs, verification and corrections', certificatesCheck], ['AUTO-007 inactivity deactivation', inactivityCheck], ['LIB-006 externally earned certificates', externalCheck], ['ORG-001 employee learning directory', directoryCheck], ['LEARN-016 GIFT and Aiken question banks', bankImportCheck], ['AUTO-001 dynamic learner audiences', audiencesCheck], ['ORG-006 bulk roster changes with a preview', rosterCheck], ['AUTO-003 relative due dates', dueDatesCheck], ['LEARN-013 recognition without implying competence', recognitionCheck], ['LEARN-014 lesson discussions with course experts', discussionsCheck], ['AUTHOR-006 content upkeep and accountable review', upkeepCheck], ['LEARN-007 skills and personal learning paths', skillsCheck], ['OPS-009 US employer defaults without payroll decisions', usEmployerCheck]].filter(([name]) => name.startsWith(only))) {
    await check(f)
    console.log(`PASS ${name}`)
  }
} finally {
  await f.h.close()
}
