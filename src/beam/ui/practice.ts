import { t, counted, localeNumber } from '../messages'
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
<h1>${t(actor, 'Practice: {title}', { title: view.title })}</h1>
<p class="banner" role="note">${t(actor, 'Practice only. It does not count toward completion and nobody scores it.')}</p>
${view.step ? h`<section class="card"><h2>${t(actor, 'Scenario')}</h2><p>${view.step.situation}</p>${view.step.choices.map((choice, index) => h`<form method="post" action="/app/do/practice.choose">${hidden('returnTo', back)}${hidden('scenario', id)}${hidden('step', view.step!.id)}${hidden('choice', index)}<button type="submit" class="choice">${choice}</button></form>`)}</section>` : ''}
${view.feedback ? h`<section class="card feedback" aria-labelledby="feedback"><h2 id="feedback">${view.finished ? t(actor, 'Last choice') : t(actor, 'Your last choice')}: ${view.feedback.choice}</h2><p>${view.feedback.text}</p>${view.feedback.sources.length ? h`<p class="muted">${view.feedback.sources.join(', ')}</p>` : ''}</section>` : ''}
${view.finished ? h`<p>${t(actor, 'You reached the end of this scenario.')}</p>` : ''}
<div class="practice-foot"><span class="muted">${view.finished ? t(actor, 'Finished · {steps} in this scenario', { steps: counted(actor, 'step', 'steps', view.steps) }) : t(actor, 'Step {n}', { n: localeNumber(actor, view.stepNumber) })}</span>${form('practice.restart', back, [hidden('scenario', id)], t(actor, 'Start again'), { secondary: true })}</div></div>`
  return page(t(actor, 'Practice: {title}', { title: view.title }), actor, body, { current: '/app/learning', url })
}

export async function questionsPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const view: any = await questionPlanView(env, actor, id)
  const back = `/app/questions/${id}`
  const invitee = view.myState === 'waiting' && view.open
  const body = h`<div class="narrow"><h1>${view.title}</h1>
<section class="card"><p>${t(actor, '{name} approved these questions: {purpose}', { name: view.approvedBy, purpose: view.purpose })}</p><p>${t(actor, 'Your answers are shown to the manager and their agent without your name, only after the questions close and only if at least {n} people answered. They are never used to rate you. Answering is optional and part of your paid work time.', { n: localeNumber(actor, MIN_ANSWERS) })}</p></section>
${invitee ? h`<form method="post" action="/app/do/questions.answer">${hidden('returnTo', back)}${hidden('plan', id)}${view.questions.map((question: string, index: number) => h`<section class="card">${area(`${index + 1}. ${question}`, `answer${index + 1}`, '', false)}</section>`)}<div class="actions"><button type="submit" class="secondary" formaction="/app/do/questions.decline" formnovalidate>${t(actor, 'I’d rather not answer')}</button><button type="submit">${t(actor, 'Send answers')}</button></div></form>`
    : view.myState ? h`<p class="card">${view.myState === 'answered' ? t(actor, 'Thank you: your answers were sent without your name.') : view.myState === 'declined' ? t(actor, 'You chose not to answer. Nothing else is needed.') : t(actor, 'These questions have closed.')}</p>` : ''}
${isManager(actor) ? h`<section class="card"><h2>Participation</h2><p>${view.participation.answered} answered · ${view.participation.declined} declined · ${view.participation.waiting} not yet · ${view.participation.invited} asked</p>
${view.open ? form('questions.close', back, [hidden('plan', id)], 'Close the questions now', { secondary: true }) : ''}
${view.answers ? h`<h2>Answers (without names, in no particular order)</h2>${view.questions.map((question: string, index: number) => h`<h3>${index + 1}. ${question}</h3><ul>${view.answers.map((answers: (string | null)[]) => answers[index]).filter(Boolean).map((answer: string) => h`<li>${answer}</li>`)}</ul>`)}`
    : h`<p class="muted">${view.hidden === 'still_open' ? 'Answers are shown once the questions close.' : 'Too few people answered to show answers without identifying anyone.'}</p>`}</section>` : ''}
<p class="muted">${t(actor, 'Closes {date}.', { date: formatDay(view.closesOn, actor.locale) })}</p></div>`
  return page(view.title, actor, body, { current: '/app/learning', url })
}
