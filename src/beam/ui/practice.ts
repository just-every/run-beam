// Learner practice and question plans: an invitee answers
// or declines; a manager sees participation and, once released, the answers.
import type { Bindings } from '../../auth.server'
import { isManager, type Actor } from '../actor'
import { practiceView } from '../practice'
import { MIN_ANSWERS, questionPlanView } from '../questions'
import { formatDay } from '../time'
import { area, backLink, form, h, hidden, page } from './html'

export async function practicePage(env: Bindings, actor: Actor, id: string, url: URL) {
  const view = await practiceView(env, actor, id)
  const back = `/app/practice/${id}`
  const body = h`<div class="narrow">${view.assignment ? backLink(`/app/learn/${view.assignment}`, view.courseTitle) : ''}
<h1>Practice: ${view.title}</h1>
<p class="banner" role="note">Practice only. It does not count toward completion and nobody scores it.</p>
${view.step ? h`<section class="card"><h2>Scenario</h2><p>${view.step.situation}</p>${view.step.choices.map((choice, index) => h`<form method="post" action="/app/do/practice.choose">${hidden('returnTo', back)}${hidden('scenario', id)}${hidden('step', view.step!.id)}${hidden('choice', index)}<button type="submit" class="choice">${choice}</button></form>`)}</section>` : ''}
${view.feedback ? h`<section class="card feedback" aria-labelledby="feedback"><h2 id="feedback">${view.finished ? 'Last choice' : 'Your last choice'}: ${view.feedback.choice}</h2><p>${view.feedback.text}</p>${view.feedback.sources.length ? h`<p class="muted">${view.feedback.sources.join(', ')}</p>` : ''}</section>` : ''}
${view.finished ? h`<p>You reached the end of this scenario.</p>` : ''}
<div class="practice-foot"><span class="muted">${view.finished ? `Finished · ${view.steps} ${view.steps === 1 ? 'step' : 'steps'} in this scenario` : `Step ${view.stepNumber}`}</span>${form('practice.restart', back, [hidden('scenario', id)], 'Start again', { secondary: true })}</div></div>`
  return page(`Practice: ${view.title}`, actor, body, { current: '/app/learning', url })
}

export async function questionsPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const view: any = await questionPlanView(env, actor, id)
  const back = `/app/questions/${id}`
  const invitee = view.myState === 'waiting' && view.open
  const body = h`<div class="narrow"><h1>${view.title}</h1>
<section class="card"><p>${view.approvedBy} approved these questions: ${view.purpose}</p><p>Your answers are shown to the manager and their agent without your name, only after the questions close and only if at least ${MIN_ANSWERS} people answered. They are never used to rate you. Answering is optional and part of your paid work time.</p></section>
${invitee ? h`<form method="post" action="/app/do/questions.answer">${hidden('returnTo', back)}${hidden('plan', id)}${view.questions.map((question: string, index: number) => h`<section class="card">${area(`${index + 1}. ${question}`, `answer${index + 1}`, '', false)}</section>`)}<div class="actions"><button type="submit" class="secondary" formaction="/app/do/questions.decline" formnovalidate>I’d rather not answer</button><button type="submit">Send answers</button></div></form>`
    : view.myState ? h`<p class="card">${view.myState === 'answered' ? 'Thank you: your answers were sent without your name.' : view.myState === 'declined' ? 'You chose not to answer. Nothing else is needed.' : 'These questions have closed.'}</p>` : ''}
${isManager(actor) ? h`<section class="card"><h2>Participation</h2><p>${view.participation.answered} answered · ${view.participation.declined} declined · ${view.participation.waiting} not yet · ${view.participation.invited} asked</p>
${view.open ? form('questions.close', back, [hidden('plan', id)], 'Close the questions now', { secondary: true }) : ''}
${view.answers ? h`<h2>Answers (without names, in no particular order)</h2>${view.questions.map((question: string, index: number) => h`<h3>${index + 1}. ${question}</h3><ul>${view.answers.map((answers: (string | null)[]) => answers[index]).filter(Boolean).map((answer: string) => h`<li>${answer}</li>`)}</ul>`)}`
    : h`<p class="muted">${view.hidden === 'still_open' ? 'Answers are shown once the questions close.' : 'Too few people answered to show answers without identifying anyone.'}</p>`}</section>` : ''}
<p class="muted">Closes ${formatDay(view.closesOn)}.</p></div>`
  return page(view.title, actor, body, { current: '/app/learning', url })
}
