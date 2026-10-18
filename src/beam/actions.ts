// Every state change in Beam, by name. The same handler serves the HTML form
// door (/app/do/NAME) and JSON door (/api/beam/NAME), subject to the
// transport and credential restrictions in http.ts and agent-credentials.ts.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { decideAcknowledgment, requestAcknowledgments } from './acknowledgments'
import { decide, propose } from './agent-work'
import { assignCourse, assignPath, assignRenewals, cancelAssignment, createPath, grantAttempt, revisePath } from './assignments'
import { createCourse, decideRevision, moveLesson, removeLesson, removeQuestion, saveAssessment, saveDetails, saveLesson, saveQuestion, submitForReview } from './courses'
import { restoreRevision } from './history'
import type { Input } from './input'
import { completeLesson, decidePractical, submitPractical, submitQuiz } from './learning'
import { decideNotice, decideProposal, proposeDraft } from './maintenance'
import { acceptHistory, applyImport, importAction, previewImport } from './movein/talentlms'
import { configureBusiness, createTeam, invitePerson, setAccess, setRoles, setTeamMembers } from './people'
import { choosePractice, restartPractice } from './practice'
import { answerQuestions, closeQuestions, declineQuestions } from './questions'
import { recordOffline } from './records'
import { resetAssignment } from './resets'
import { addSourceVersion, createSource } from './sources'

type Handler = (env: Bindings, actor: Actor, input: Input, request: Request) => Promise<unknown>

export const actions: Record<string, Handler> = {
  'business.configure': (env, actor, input) => configureBusiness(env, actor, input),
  'person.invite': (env, actor, input, request) => invitePerson(env, request, actor, input),
  'person.roles': (env, actor, input) => setRoles(env, actor, input),
  'person.access': (env, actor, input, request) => setAccess(env, request, actor, input),
  'team.create': (env, actor, input) => createTeam(env, actor, input),
  'team.members': (env, actor, input) => setTeamMembers(env, actor, input),
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
  'course.assessment': (env, actor, input) => saveAssessment(env, actor, input),
  'course.submit': (env, actor, input) => submitForReview(env, actor, input),
  'course.restore': (env, actor, input) => restoreRevision(env, actor, input),
  'revision.decide': (env, actor, input) => decideRevision(env, actor, input),
  'proposal.create': (env, actor, input) => proposeDraft(env, actor, input, input.json('draft')),
  'proposal.decide': (env, actor, input) => decideProposal(env, actor, input),
  'notice.decide': (env, actor, input) => decideNotice(env, actor, input),
  'path.create': (env, actor, input) => createPath(env, actor, input),
  'path.revise': (env, actor, input) => revisePath(env, actor, input),
  'path.assign': (env, actor, input) => assignPath(env, actor, input),
  'assignment.create': (env, actor, input) => assignCourse(env, actor, input),
  'assignment.cancel': (env, actor, input) => cancelAssignment(env, actor, input),
  'assignment.renewals': (env, actor, input) => assignRenewals(env, actor, input),
  'attempt.grant': (env, actor, input) => grantAttempt(env, actor, input),
  'assignment.reset': (env, actor, input) => resetAssignment(env, actor, input),
  'lesson.complete': (env, actor, input) => completeLesson(env, actor, input),
  'quiz.submit': (env, actor, input) => submitQuiz(env, actor, input),
  'practical.submit': (env, actor, input) => submitPractical(env, actor, input),
  'practical.decide': (env, actor, input) => decidePractical(env, actor, input),
  'offline.record': (env, actor, input) => recordOffline(env, actor, input),
  'import.preview': (env, actor, input) => previewImport(env, actor, input),
  'import.apply': (env, actor, input) => applyImport(env, actor, input),
  'import.job': (env, actor, input) => importAction(env, actor, input),
  'history.accept': (env, actor, input) => acceptHistory(env, actor, input),
  'agent.propose': (env, actor, input) => propose(env, actor, input),
  'agent.decide': (env, actor, input) => decide(env, actor, input),
  'practice.choose': (env, actor, input) => choosePractice(env, actor, input),
  'practice.restart': (env, actor, input) => restartPractice(env, actor, input),
  'questions.answer': (env, actor, input) => answerQuestions(env, actor, input),
  'questions.decline': (env, actor, input) => declineQuestions(env, actor, input),
  'questions.close': (env, actor, input) => closeQuestions(env, actor, input),
}
