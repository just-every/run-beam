import { configureGustoLanguage, revokeGustoLanguage, pullGustoLanguage } from './connect/gusto-language'
import { saveLocaleGlossary, approveLocaleGlossary, prepareCourseLocale, editCourseLocale, submitCourseLocale, approveCourseLocale } from './course-locales'
import { registerLti, rotateLtiKeys, revokeLti, rotateLtiPlatform, deepLinkLti, attachLti, launchLti, reconcileLti } from './lti'
import { setMyLanguage, setLanguageDefault } from './language'
import { requireOwner } from './actor'
import { subscribeWebhook, rotateWebhook, setWebhookState, replayWebhook, runWebhooks } from './webhooks'
import { saveBlock, changeBlock, reuseBlock } from './blocks'
import { saveEmbedPolicy } from './media'
import { convertSource } from './source-extraction'
import { saveRenewal, previewRenewal, setRenewalState, replayRenewal } from './renewals'
import { setRenewalNoticeConsent } from './renewal-notice-outbox'
import { replayRenewalNotice } from './renewal-notices'
import { saveEscalationPolicy, resolveEscalation, runEscalationsNow } from './escalations'
import { withdrawErrors } from './diagnosis-evidence'
import { prepareDiagnosis } from './diagnosis-comparison'
// Every state change in Beam, by name. The same handler serves the HTML form
// door (/app/do/NAME) and JSON door (/api/beam/NAME), subject to the
// transport and credential restrictions in http.ts and agent-credentials.ts.
import { createDashboard, shareDashboard, linkDashboard, revokeDashboard, revokeDashboardShare } from './dashboards'
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { extendAccess, setAccessRule, setAssignmentWindow } from './access'
import { decideAcknowledgment, requestAcknowledgments } from './acknowledgments'
import { decide, propose } from './agent-work'
import { answerSurvey } from './survey'
import { decideReview, runUpkeepNow, saveUpkeep } from './upkeep'
import { createSkill, mapCourse, mapRole, recordDiagnostic, reviewSkill, setGoals, setPersonalization } from './skills'
import { approvePath } from './recommendations'
import { recordDiagnosis, reviewDiagnosis } from './interventions'
import { approvePlan, importOutcomes, proposePlan } from './outcomes'
import { closeMeasurement, retireAssignments } from './evaluations'
import { issueCredential, revokeCredential, rotateCredential } from './app-credentials'
import { assignCourse, assignPath, assignRenewals, previewPath, cancelAssignment, createPath, grantAttempt, moveDueDate, revisePath } from './assignments'
import { endCoverage, grantCoverage, setTeamManagers } from './managers'
import { declineBlocker, grantException, reportBlocker, setExceptionPolicy } from './exceptions'
import { saveNotification, setNotificationEnabled, testNotification } from './notification-rules'
import { replayNotifications } from './notification-delivery'
import { approveAutomation, saveAutomationPolicy } from './automation-policy'
import { previewRule, replayRule, saveRule, setRuleState } from './automation'
import { approvePolicy, revokePolicy } from './inactivity-scheduled'
import { previewPolicy, runPolicy, savePolicy, setPolicyEnabled } from './inactivity'
import { cancelSession, rescheduleSession, scheduleSession, setSeats, updateSession } from './live'
import { acceptOffer, leave, register } from './registrations'
import { amendAttendance, recordAttendance } from './attendance'
import { addComment, resolveConflict, resolveThread } from './collab'
import { closeFeedback, sendFeedback } from './feedback'
import { grantInstructor, revokeInstructor } from './instructors'
import { decideRequest, requestEnrollment, saveSearch, selfEnroll, setEnrollment, setFavorite, withdraw } from './catalog'
import { grantRole, revokeRole, saveRole } from './roles'
import { grantAuditor, revokeAuditor } from './auditors'
import { correctAudit } from './audit'
import { replyToAnnouncement, sendAnnouncement } from './announcements'
import { archiveCourse, cloneCourse, reinstateCourse, retagCourses, retireCourse, setCatalog } from './estate'
import { createCourse, decideRevision, moveLesson, removeLesson, removeQuestion, saveAssessment, saveAttendance, saveDetails, saveLesson, saveQuestion, saveSurvey, submitForReview } from './courses'
import { restoreRevision } from './history'
import type { Input } from './input'
import { completeLesson, decidePractical, gradeQuiz, saveQuizAnswers, startQuiz, submitPractical, submitQuiz } from './learning'
import { decideNotice, decideProposal, proposeDraft } from './maintenance'
import { proposeImpact } from './impact'
import { acceptHistory } from './movein/talentlms'
import { approveCredit, previewCredit, undoCredit } from './credits'
import { saveExpiringWindow } from './report'
import { saveImportSettings } from './movein/door'
import { configureBusiness, createTeam, invitePerson, setAccess, setRoles, setTeamMembers } from './people'
import { choosePractice, restartPractice } from './practice'
import { answerQuestions, closeQuestions, declineQuestions } from './questions'
import { recordOffline } from './records'
import { resetAssignment } from './resets'
import { grantAccommodation } from './timing'
import { addSourceVersion, createSource } from './sources'
import { decideCertificate, saveRequirement, uploadCertificate } from './external'
import { correctCertificate, createLink, revokeLink, saveTemplate, setCourseTemplate } from './certificates'
import { replaceReviewer, setCourseAuthors, setSelfReview } from './course-access'
import { importBank, previewBank } from './bank-import'
import { excludeFromAudience, includeInAudience, previewAudience, saveAudience, setAudienceState, syncAudience, syncAudiences } from './audiences'
import { applyBatch, previewBatch } from './roster-batch'
import { editDirectory, importRoster, resolveConflict as resolveRosterConflict, saveDirectoryField } from './directory'
import { retireBadge, saveBadge, saveChallenge, setGroupRecognition, setPoints, setVisibility } from './recognition'
import { askQuestion, decideFile, hidePost, proposeFromThread, reply, resolveQuestion } from './discussions'
import { createUnit, grantAdministration, revokeAdministration, setCourseUnit, setUnitTeams } from './units'

type Handler = (env: Bindings, actor: Actor, input: Input, request: Request) => Promise<unknown>

/** AUTO-001: a roster change (directory, import, resolved conflict, team members) synchronizes the active audiences. */
const synced = (handler: Handler): Handler => async (env, actor, input, request) => {
  const result = await handler(env, actor, input, request)
  return { ...result as object, audiences: await syncAudiences(env, actor) }
}

export const actions: Record<string, Handler> = {
  'lti.register': registerLti, 'lti.keys': rotateLtiKeys, 'lti.revoke': revokeLti,
  'lti.platform.rotate': rotateLtiPlatform, 'lti.deep-link': deepLinkLti, 'lti.attach': attachLti, 'lti.launch': launchLti, 'lti.reconcile': reconcileLti,
  'language.change': setMyLanguage,
  'language.default': setLanguageDefault,
  'webhook.subscribe': subscribeWebhook,
  'webhook.rotate': rotateWebhook,
  'webhook.state': setWebhookState,
  'webhook.replay': replayWebhook,
  'webhook.run': async (env, actor) => ({ results: await runWebhooks(env, actor) }),
  'course.block': saveBlock,
  'course.block.change': changeBlock,
  'course.block.reuse': reuseBlock,
  'embed.policy': saveEmbedPolicy,
  'escalation.policy': saveEscalationPolicy,
  'escalation.resolve': resolveEscalation,
  'escalation.run': runEscalationsNow,
  'dashboard.create': createDashboard,
  'dashboard.share': shareDashboard,
  'dashboard.link': linkDashboard,
  'dashboard.revoke': revokeDashboard,
  'dashboard.share.revoke': revokeDashboardShare,
  'business.configure': (env, actor, input) => configureBusiness(env, actor, input),
  'person.invite': (env, actor, input, request) => invitePerson(env, request, actor, input),
  'person.roles': (env, actor, input) => setRoles(env, actor, input),
  'person.access': (env, actor, input, request) => setAccess(env, request, actor, input),
  'person.directory': synced((env, actor, input, request) => editDirectory(env, request, actor, input)),
  'person.field': (env, actor, input) => saveDirectoryField(env, actor, input),
  'people.import': synced((env, actor, input, request) => importRoster(env, request, actor, input)),
  'people.batch.preview': (env, actor, input) => previewBatch(env, actor, input),
  'people.batch.apply': synced((env, actor, input, request) => applyBatch(env, request, actor, input)),
  'people.conflict': synced((env, actor, input, request) => resolveRosterConflict(env, request, actor, input)),
  'team.create': (env, actor, input) => createTeam(env, actor, input),
  'external.requirement': (env, actor, input) => saveRequirement(env, actor, input),
  'external.upload': (env, actor, input) => uploadCertificate(env, actor, input),
  'external.decide': (env, actor, input) => decideCertificate(env, actor, input),
  'certificate.template': (env, actor, input) => saveTemplate(env, actor, input),
  'course.certificate': (env, actor, input) => setCourseTemplate(env, actor, input),
  'certificate.correct': (env, actor, input) => correctCertificate(env, actor, input),
  'certificate.link': (env, actor, input) => createLink(env, actor, input),
  'certificate.unlink': (env, actor, input) => revokeLink(env, actor, input),
  'team.members': synced((env, actor, input) => setTeamMembers(env, actor, input)),
  'team.managers': (env, actor, input) => setTeamManagers(env, actor, input),
  'team.coverage': (env, actor, input) => grantCoverage(env, actor, input),
  'team.coverage.end': (env, actor, input) => endCoverage(env, actor, input),
  'assignment.due': (env, actor, input) => moveDueDate(env, actor, input),
  'blocker.report': (env, actor, input) => reportBlocker(env, actor, input),
  'blocker.decline': (env, actor, input) => declineBlocker(env, actor, input),
  'exception.grant': (env, actor, input) => grantException(env, actor, input),
  'exception.policy': (env, actor, input) => setExceptionPolicy(env, actor, input),
  'notification.save': (env, actor, input) => saveNotification(env, actor, input),
  'notification.state': (env, actor, input) => setNotificationEnabled(env, actor, input),
  'notification.test': (env, actor, input) => testNotification(env, actor, input),
  'notification.replay': (env, actor, input) => replayNotifications(env, actor, input),
  'renewal.save': saveRenewal,
  'renewal.preview': previewRenewal,
  'renewal.state': setRenewalState,
  'renewal.replay': replayRenewal,
  'renewal.notice-consent': setRenewalNoticeConsent,
  'renewal.notice-replay': replayRenewalNotice,
  'automation.policy': (env, actor, input) => saveAutomationPolicy(env, actor, input),
  'automation.approve': (env, actor, input) => approveAutomation(env, actor, input),
  'automation.save': (env, actor, input) => saveRule(env, actor, input),
  'course.enrollment': (env, actor, input) => setEnrollment(env, actor, input),
  'catalog.enroll': (env, actor, input) => selfEnroll(env, actor, input),
  'catalog.request': (env, actor, input) => requestEnrollment(env, actor, input),
  'catalog.decide': (env, actor, input) => decideRequest(env, actor, input),
  'catalog.withdraw': (env, actor, input) => withdraw(env, actor, input),
  'catalog.favorite': (env, actor, input) => setFavorite(env, actor, input),
  'catalog.search': (env, actor, input) => saveSearch(env, actor, input),
  'session.schedule': (env, actor, input) => scheduleSession(env, actor, input),
  'session.reschedule': (env, actor, input) => rescheduleSession(env, actor, input),
  'session.update': (env, actor, input) => updateSession(env, actor, input),
  'session.cancel': (env, actor, input) => cancelSession(env, actor, input),
  'session.register': (env, actor, input) => register(env, actor, input),
  'session.leave': (env, actor, input) => leave(env, actor, input),
  'session.seats': (env, actor, input) => setSeats(env, actor, input),
  'session.accept': (env, actor, input) => acceptOffer(env, actor, input),
  'attendance.record': (env, actor, input) => recordAttendance(env, actor, input),
  'attendance.amend': (env, actor, input) => amendAttendance(env, actor, input),
  'conflict.resolve': (env, actor, input) => resolveConflict(env, actor, input),
  'course.comment': (env, actor, input) => addComment(env, actor, input),
  'course.thread.resolve': (env, actor, input) => resolveThread(env, actor, input),
  'feedback.send': (env, actor, input) => sendFeedback(env, actor, input),
  'feedback.close': (env, actor, input) => closeFeedback(env, actor, input),
  'instructor.grant': (env, actor, input) => grantInstructor(env, actor, input),
  'instructor.revoke': (env, actor, input) => revokeInstructor(env, actor, input),
  'inactivity.policy': (env, actor, input) => savePolicy(env, actor, input),
  'inactivity.preview': (env, actor) => previewPolicy(env, actor),
  'inactivity.enable': (env, actor, input) => setPolicyEnabled(env, actor, input),
  'inactivity.approve': (env, actor, input, request) => approvePolicy(env, actor, input, request),
  'inactivity.revoke': (env, actor, input, request) => revokePolicy(env, actor, input, request),
  'inactivity.run': (env, actor, input, request) => runPolicy(env, actor, input, request),
  'automation.preview': (env, actor, input) => previewRule(env, actor, input),
  'automation.state': (env, actor, input) => setRuleState(env, actor, input),
  'automation.replay': (env, actor, input) => replayRule(env, actor, input),
  'audience.save': (env, actor, input) => saveAudience(env, actor, input),
  'audience.preview': (env, actor, input) => previewAudience(env, actor, input),
  'audience.state': (env, actor, input) => setAudienceState(env, actor, input),
  'audience.sync': (env, actor, input) => syncAudience(env, actor, input),
  'audience.exclude': (env, actor, input) => excludeFromAudience(env, actor, input),
  'audience.include': (env, actor, input) => includeInAudience(env, actor, input),
  'auditor.grant': (env, actor, input) => grantAuditor(env, actor, input),
  'auditor.revoke': (env, actor, input) => revokeAuditor(env, actor, input),
  'role.save': (env, actor, input) => saveRole(env, actor, input),
  'role.grant': (env, actor, input) => grantRole(env, actor, input),
  'role.revoke': (env, actor, input) => revokeRole(env, actor, input),
  'unit.create': (env, actor, input) => createUnit(env, actor, input),
  'unit.teams': (env, actor, input) => setUnitTeams(env, actor, input),
  'course.unit': (env, actor, input) => setCourseUnit(env, actor, input),
  'course.authors': (env, actor, input) => setCourseAuthors(env, actor, input),
  'course.reviewer': (env, actor, input) => replaceReviewer(env, actor, input),
  'course.selfreview': (env, actor, input) => setSelfReview(env, actor, input),
  'admin.grant': (env, actor, input) => grantAdministration(env, actor, input),
  'admin.revoke': (env, actor, input) => revokeAdministration(env, actor, input),
  'source.convert': (env, actor, input) => convertSource(env, actor, input),
  'source.create': (env, actor, input) => createSource(env, actor, input),
  'source.version': (env, actor, input) => addSourceVersion(env, actor, input),
  'acknowledgment.request': (env, actor, input) => requestAcknowledgments(env, actor, input),
  'acknowledgment.decide': (env, actor, input) => decideAcknowledgment(env, actor, input),
  'course.create': (env, actor, input) => createCourse(env, actor, input),
  'course.details': (env, actor, input) => saveDetails(env, actor, input),
  'course.lesson': (env, actor, input) => saveLesson(env, actor, input),
  'course.lesson.remove': (env, actor, input) => removeLesson(env, actor, input),
  'course.lesson.move': (env, actor, input) => moveLesson(env, actor, input),
  'course.question': (env, actor, input) => saveQuestion(env, actor, input),
  'course.question.remove': (env, actor, input) => removeQuestion(env, actor, input),
  'bank.preview': (env, actor, input) => previewBank(env, actor, input),
  'bank.import': (env, actor, input) => importBank(env, actor, input),
  'course.assessment': (env, actor, input) => saveAssessment(env, actor, input),
  'course.attendance': (env, actor, input) => saveAttendance(env, actor, input),
  'course.survey': (env, actor, input) => saveSurvey(env, actor, input),
  'course.submit': (env, actor, input) => submitForReview(env, actor, input),
  'course.restore': (env, actor, input) => restoreRevision(env, actor, input),
  'gusto.language.configure': configureGustoLanguage,
  'gusto.language.revoke': revokeGustoLanguage,
  'gusto.language.pull': pullGustoLanguage,
  'glossary.save': saveLocaleGlossary,
  'glossary.approve': approveLocaleGlossary,
  'locale.prepare': prepareCourseLocale,
  'locale.edit': editCourseLocale,
  'locale.submit': submitCourseLocale,
  'locale.approve': approveCourseLocale,
  'revision.decide': (env, actor, input) => decideRevision(env, actor, input),
  'proposal.create': (env, actor, input) => proposeDraft(env, actor, input, input.json('draft')),
  'proposal.decide': (env, actor, input) => decideProposal(env, actor, input),
  'notice.decide': (env, actor, input) => decideNotice(env, actor, input),
  'impact.propose': (env, actor, input) => proposeImpact(env, actor, input),
  'course.upkeep': (env, actor, input) => saveUpkeep(env, actor, input),
  'review.decide': (env, actor, input) => decideReview(env, actor, input),
  'upkeep.run': (env, actor) => runUpkeepNow(env, actor),
  'skill.create': (env, actor, input) => createSkill(env, actor, input),
  'skill.review': (env, actor, input) => reviewSkill(env, actor, input),
  'skill.course': (env, actor, input) => mapCourse(env, actor, input),
  'skill.role': (env, actor, input) => mapRole(env, actor, input),
  'skill.goals': (env, actor, input) => setGoals(env, actor, input),
  'skill.personalization': (env, actor, input) => setPersonalization(env, actor, input),
  'skill.diagnostic': (env, actor, input) => recordDiagnostic(env, actor, input),
  'skill.path.approve': (env, actor, input) => approvePath(env, actor, input),
  'diagnosis.withdraw': (env, actor, input) => withdrawErrors(env, actor, input),
  'diagnosis.prepare': (env, actor, input) => prepareDiagnosis(env, actor, input),
  'diagnosis.record': (env, actor, input) => recordDiagnosis(env, actor, input),
  'diagnosis.review': (env, actor, input) => reviewDiagnosis(env, actor, input),
  'outcome.plan': (env, actor, input) => proposePlan(env, actor, input),
  'outcome.approve': (env, actor, input) => approvePlan(env, actor, input),
  'outcome.import': (env, actor, input) => importOutcomes(env, actor, input),
  'outcome.close': (env, actor, input) => closeMeasurement(env, actor, input),
  'outcome.retire': (env, actor, input) => retireAssignments(env, actor, input),
  'app.issue': (env, actor, input) => issueCredential(env, actor, input),
  'app.rotate': (env, actor, input) => rotateCredential(env, actor, input),
  'app.revoke': (env, actor, input) => revokeCredential(env, actor, input),
  'path.create': (env, actor, input) => createPath(env, actor, input),
  'path.revise': (env, actor, input) => revisePath(env, actor, input),
  'path.assign': (env, actor, input) => assignPath(env, actor, input),
  'path.preview': (env, actor, input) => previewPath(env, actor, input),
  'assignment.create': (env, actor, input) => assignCourse(env, actor, input),
  'assignment.cancel': (env, actor, input) => cancelAssignment(env, actor, input),
  'assignment.renewals': (env, actor, input) => assignRenewals(env, actor, input),
  'access.rule': (env, actor, input) => setAccessRule(env, actor, input),
  'audit.correct': (env, actor, input) => correctAudit(env, actor, input),
  'announcement.send': (env, actor, input) => sendAnnouncement(env, actor, input),
  'announcement.reply': (env, actor, input) => replyToAnnouncement(env, actor, input),
  'course.retire': (env, actor, input) => retireCourse(env, actor, input),
  'course.reinstate': (env, actor, input) => reinstateCourse(env, actor, input),
  'course.clone': (env, actor, input) => cloneCourse(env, actor, input),
  'course.catalog': (env, actor, input) => setCatalog(env, actor, input),
  'course.retag': (env, actor, input) => retagCourses(env, actor, input),
  'course.archive': (env, actor, input) => archiveCourse(env, actor, input),
  'assignment.window': (env, actor, input) => setAssignmentWindow(env, actor, input),
  'access.extend': (env, actor, input) => extendAccess(env, actor, input),
  'attempt.grant': (env, actor, input) => grantAttempt(env, actor, input),
  'accommodation.grant': (env, actor, input) => grantAccommodation(env, actor, input),
  'assignment.reset': (env, actor, input) => resetAssignment(env, actor, input),
  'lesson.complete': (env, actor, input) => completeLesson(env, actor, input),
  'quiz.start': (env, actor, input) => startQuiz(env, actor, input),
  'quiz.save': (env, actor, input) => saveQuizAnswers(env, actor, input),
  'quiz.submit': (env, actor, input) => submitQuiz(env, actor, input),
  'practical.submit': (env, actor, input) => submitPractical(env, actor, input),
  'practical.decide': (env, actor, input) => decidePractical(env, actor, input),
  'quiz.grade': (env, actor, input) => gradeQuiz(env, actor, input),
  'survey.answer': (env, actor, input) => answerSurvey(env, actor, input),
  'offline.record': (env, actor, input) => recordOffline(env, actor, input),
  'import.settings': (env, actor, input) => saveImportSettings(env, actor, input),
  'history.accept': (env, actor, input) => acceptHistory(env, actor, input),
  // REPORT-001 / MOVE-009: the expiring window and imported-history credit decisions.
  'report.window': (env, actor, input) => saveExpiringWindow(env, actor, input),
  'credit.preview': (env, actor, input) => previewCredit(env, actor, input),
  'credit.approve': (env, actor, input) => approveCredit(env, actor, input),
  'credit.undo': (env, actor, input) => undoCredit(env, actor, input),
  'agent.propose': (env, actor, input) => propose(env, actor, input),
  'agent.decide': (env, actor, input) => decide(env, actor, input),
  'practice.choose': (env, actor, input) => choosePractice(env, actor, input),
  'practice.restart': (env, actor, input) => restartPractice(env, actor, input),
  'questions.answer': (env, actor, input) => answerQuestions(env, actor, input),
  'questions.decline': (env, actor, input) => declineQuestions(env, actor, input),
  'questions.close': (env, actor, input) => closeQuestions(env, actor, input),
  'recognition.points': (env, actor, input) => setPoints(env, actor, input),
  'recognition.badge': (env, actor, input) => saveBadge(env, actor, input),
  'recognition.badge.retire': (env, actor, input) => retireBadge(env, actor, input),
  'recognition.group': (env, actor, input) => setGroupRecognition(env, actor, input),
  'recognition.challenge': (env, actor, input) => saveChallenge(env, actor, input),
  'recognition.visibility': (env, actor, input) => setVisibility(env, actor, input),
  'discussion.ask': (env, actor, input) => askQuestion(env, actor, input),
  'discussion.reply': (env, actor, input) => reply(env, actor, input),
  'discussion.resolve': (env, actor, input) => resolveQuestion(env, actor, input),
  'discussion.propose': (env, actor, input) => proposeFromThread(env, actor, input),
  'discussion.file': (env, actor, input) => decideFile(env, actor, input),
  'discussion.hide': (env, actor, input) => hidePost(env, actor, input),
}
