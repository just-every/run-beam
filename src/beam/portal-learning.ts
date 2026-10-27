// Native lesson progress is isolated from employee assignments and earned evidence.
import type { Bindings } from '../auth.server'
import { all, insist, newId, now, one, stmt } from './core'
import { Input } from './input'

import { portalAdmission } from './portal-admission'
import { portalBlocks, portalLessonAvailable, portalUnsupportedBlocks } from './portal-media'

export async function portalLearning(env: Bindings, request: Request, portal: string, identity: string, account: string, download: boolean) {
  insist(!download || request.method !== 'POST', 'method_not_allowed', 405)
  const input = request.method === 'POST' ? await Input.from(request) : null
  const enrollment = input ? input.text('enrollment') : new URL(request.url).searchParams.get('enrollment')
  insist(enrollment, 'missing_enrollment')
  const args = [portal, enrollment, identity, account]
  const enrolled = await one(env, portalAdmission, ...args)
  insist(enrolled, 'portal_enrollment_not_found', 404)
  if (input) {
    const lesson = input.text('lesson'), at = now(), event = newId()
    const found = await one(env, 'SELECT blocks_json FROM beam_lesson_revisions WHERE id=? AND course_revision_id=?', lesson, enrolled.revision_id)
    insist(found, 'portal_lesson_not_found', 404)
    // External tools and embeds remain unavailable until their portal boundary is qualified.
    insist(portalLessonAvailable(JSON.parse(found.blocks_json)), 'portal_lesson_delivery_unavailable', 409)
    const result = await env.DB.batch([
      stmt(env, `INSERT INTO beam_portal_lesson_progress(enrollment_id,lesson_revision_id,completed_at)
        SELECT e.id,l.id,?6 FROM (${portalAdmission}) e JOIN beam_lesson_revisions l ON l.course_revision_id=e.revision_id
        WHERE l.id=?5 AND NOT ${portalUnsupportedBlocks}
        ON CONFLICT(enrollment_id,lesson_revision_id) DO NOTHING`, ...args, lesson, at),
      stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail)
        SELECT ?1,?2,'portal.lesson.read',?3,?4 WHERE changes()=1`, at, account, portal,
        JSON.stringify({ identity, enrollment, revision: enrolled.revision_id, lesson, outcome: 'recorded', event })),
    ])
    // An idempotent repeat still requires current admission; a raced revocation cannot report success.
    insist(await one(env, portalAdmission, ...args), 'portal_enrollment_not_found', 404)
    insist(result[0].meta.changes === 1 || await one(env, 'SELECT 1 FROM beam_portal_lesson_progress WHERE enrollment_id=? AND lesson_revision_id=?', enrollment, lesson), 'portal_progress_conflict', 409)
  }
  const revision = await one(env, 'SELECT id,title,number FROM beam_course_revisions WHERE id=?', enrolled.revision_id)
  const lessons = await all(env, `SELECT l.id,l.title,l.body,l.position,l.blocks_json,p.completed_at AS completedAt
    FROM beam_lesson_revisions l LEFT JOIN beam_portal_lesson_progress p ON p.lesson_revision_id=l.id AND p.enrollment_id=?
    WHERE l.course_revision_id=? ORDER BY l.position,l.id`, enrollment, enrolled.revision_id)
  const rows = lessons.map(row => ({ id: row.id, title: row.title, completedAt: row.completedAt,
    ...download ? {} : { body: portalLessonAvailable(JSON.parse(row.blocks_json)) ? row.body : null, available: portalLessonAvailable(JSON.parse(row.blocks_json)), blocks: portalLessonAvailable(JSON.parse(row.blocks_json)) ? portalBlocks(JSON.parse(row.blocks_json)) : [] } }))
  const data = { portal, enrollment, revision, lessons: rows,
    resumeLesson: lessons.find(row => row.completedAt === null)?.id ?? null,
    lessonsRead: lessons.filter(row => row.completedAt !== null).length,
    // Reading every lesson is progress, never a course completion or assessment result.
    completion: await one(env, 'SELECT id,revision_id AS revision,assessment_revision_id AS assessmentRevision,completed_at AS completedAt,certificate_number AS number FROM beam_portal_completions WHERE enrollment_id=?', enrollment), scope: 'Native text lesson progress; completion requires a separate qualified evidence decision.' }
  const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    ...download ? { 'content-disposition': 'attachment; filename="beam-portal-progress.json"', 'content-security-policy': "sandbox; default-src 'none'" } : {} }
  return request.method === 'HEAD' ? new Response(null, { headers }) : Response.json(data, { headers })
}
