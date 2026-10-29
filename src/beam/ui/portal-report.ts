import type { PortalReport } from '../portal-report'
import { card, h, pill, rows, type Html } from './html'

const states = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed' }

// Body fragment for the existing branded portal frame; every action has a visible label.
export function portalReportFragment(base: string, data: PortalReport): Html {
  return h`<p class="lede">Progress and completion</p>
    <p><a href="${base}/catalog">Shared catalog</a> · <a href="${base}/roster">Consenting learners</a> · <a href="${base}/consent">Your consent</a></p>
    ${card('Portal learning report', h`<p>Only current consenting learners and shared approved revisions in this portal are shown. Lesson reads and passing assessments record progress. Completion and certificate details appear only after completion is earned.</p>
      <p><a href="${base}/report.csv">Download progress report</a></p>
      ${data.enrollments.length ? rows(data.enrollments.map(row => ({
        title: row.name,
        meta: h`<span>${row.courseTitle} · Revision ${row.revisionNumber}</span><br>
          <span>Approved revision: ${row.revision}</span><br>
          <span>Enrolled ${new Date(row.enrolledAt).toISOString()}</span><br>
          <span>Lessons read: ${row.lessonsRead} of ${row.totalLessons}</span><br>
          <span>Assessment attempts: ${row.attempts} · ${row.assessmentPassed === 1 ? 'Passed' : row.assessmentPassed === 0 ? 'Not passed' : 'No attempts'}</span><br>
          ${data.reviewing && row.reviewable && row.pendingReviews ? h`<a href="/portal/${base.split('/').at(-1)}/assessment-review?enrollment=${row.id}">Review written answers</a><br>` : ''}${data.reviewing && row.reviewable && row.practicalPending ? h`<a href="/portal/${base.split('/').at(-1)}/practical-review?enrollment=${row.id}">Review practical evidence</a><br>` : ''}${row.completion ? h`<span>Certificate: ${row.certificateNumber}</span><br><span>Completed ${new Date(row.completedAt!).toISOString()}</span>` : h`<span>Completion has not been earned.</span>`}`,
        aside: pill(row.status === 'completed' ? 'done' : 'waiting', states[row.status]),
      }))) : h`<p>No current enrollments to show.</p>`}`)}`
}
