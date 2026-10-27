import type { PortalPracticalData } from '../portal-practical'
import { card, h, hidden, lessonText, type Html } from './html'

// Contextual fragment for the existing portal frame. It adds no employee navigation.
export function portalPracticalFragment(base: string, data: PortalPracticalData): Html {
  const action = `${base}/${data.review ? 'practical-review' : 'practical'}?enrollment=${encodeURIComponent(data.enrollment)}`
  const history = data.submissions.map(row => card(`Submission ${row.number}`, h`
    <p>Submitted ${new Date(row.submittedAt).toISOString()}</p>
    ${lessonText(row.evidence)}
    <p role="status">${row.state === 'accepted' ? 'Evidence accepted' : row.state === 'rejected' ? 'Resubmission requested' : 'Awaiting the named assessor'}</p>
    ${row.decision ? h`<p>Decided ${new Date(row.decision.decidedAt).toISOString()}</p>${lessonText(row.decision.note)}` : data.review ? h`
      <form method="post" action="${action}">
        ${hidden('enrollment', data.enrollment)}${hidden('submission', row.id)}
        <label>Decision note<textarea name="note" maxlength="2000" required rows="4"></textarea></label>
        <button type="submit" name="decision" value="accepted">Accept evidence</button>
        <button type="submit" name="decision" value="rejected" class="secondary">Request resubmission</button>
      </form>` : ''}`))
  return h`<h1>${data.review ? 'Review practical evidence' : 'Practical assessment'}</h1>
    ${data.review ? h`<p><a href="/app/portal/${data.portal}/report">Back to progress report</a></p><p>Learner: ${data.learner}</p>` : h`<p class="actions"><a href="${base}/learning?enrollment=${data.enrollment}">Back to enrolled lessons</a><a href="${base}/consent">Consent settings</a></p>`}
    <p>Approved revision: ${data.revision}</p>
    ${card('Practical instructions', data.available ? h`${lessonText(data.instructions ?? '')}<p>Acceptance records the named assessor's decision. Course completion is recorded separately after every requirement is met.</p><p>Describe your work in text. File attachments are not available in this portal yet.</p>` : h`<p>This revision has no practical assessment available.</p>`)}
    ${!data.review && data.available ? card('Your evidence', data.accepted ? h`<p role="status">Practical evidence accepted.</p>` : data.pending ? h`<p role="status">Your evidence is waiting for the named assessor. Your submitted text is retained below.</p>` : !data.lessonsComplete ? h`<p>Read all enrolled lessons before submitting practical evidence.</p>` : h`
      <form method="post" action="${action}">
        ${hidden('enrollment', data.enrollment)}${hidden('submission', data.submission!)}
        <label>Describe what you did<textarea name="evidence" maxlength="10000" required rows="6"></textarea></label>
        <p>Your submitted evidence is visible to you and the current human owner only when that owner is this revision's named assessor.</p>
        <button type="submit">Submit practical evidence</button>
      </form>`) : ''}
    ${history}
    ${!data.review ? h`<p><a href="${base}/completion?enrollment=${data.enrollment}">Review course completion</a></p>` : ''}`
}
