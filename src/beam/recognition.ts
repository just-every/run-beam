// LEARN-013: recognition of learning activity that never stands for competence. The owner (acting as the employer's
// administrator) sets points per finished lesson and per finished course and the badges, each tied to one transparent
// milestone: finishing a named course, or finishing a number of different courses. The owner, or a learning
// administrator for a group of their units, switches on levels and an activity leaderboard for a group (a team, or a
// cohort: an AUTO-001 audience) and sets its challenges (a number of course completions between two dates). Everything is read from native records only: each
// distinct lesson a person finished and each distinct course they completed (beam_lesson_progress and
// beam_completions). Scores, attempts, practice runs, anonymous answers and imported history are never read, so
// recognition cannot change completion, attempts, certificates or private practice. A person who opts out of public
// recognition is left off every leaderboard and out of challenge counts; they still see their own points and badges.
// Nobody appears on a leaderboard before they have seen the one-time notice with the opt-out (ct 19 Oct 12:42Z).
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { addDays, zonedInstant } from './time'

export const LEADERBOARD_LABEL = 'Counts learning activity (lessons and courses finished), not competence. Scores, practice and anonymous answers never count.'
const ACTIVE_MEMBER = "NOT EXISTS (SELECT 1 FROM oa_operators o WHERE o.id = m.operator_id AND o.status <> 'active')"
const yes = (input: Input, name: string) => ['on', 'true', '1', 'yes'].includes(input.text(name, { optional: true, max: 5 }).toLowerCase())

/** Teams and cohorts (AUTO-001 audiences that are not drafts), with whether this person is in each now. */
const GROUPS = `SELECT 'team' AS kind, t.id, t.name, t.unit_id AS unit, EXISTS (SELECT 1 FROM beam_team_members x WHERE x.team_id = t.id AND x.member_id = ?1) AS member FROM beam_teams t
  UNION ALL SELECT 'audience', a.id, a.name, a.unit_id, EXISTS (SELECT 1 FROM beam_audience_members x WHERE x.audience_id = a.id AND x.member_id = ?1 AND x.left_at IS NULL) FROM beam_audiences a WHERE a.state <> 'draft'`
/** Current members of every group: a team's members, an audience's people with an open stint. */
const GROUP_MEMBERS = `SELECT 'team' AS kind, team_id AS groupId, member_id AS member FROM beam_team_members
  UNION ALL SELECT 'audience', audience_id, member_id FROM beam_audience_members WHERE left_at IS NULL`

/** The owner, or a learning administrator whose units include the team or cohort. */
async function requireGroupAdministrator(env: Bindings, actor: Actor, input: Input) {
  // The group is its id with `kind` (team when absent), or one `kind:id` value from the page's group choice.
  const value = input.text('group', { max: 80 })
  const [kind, id] = value.includes(':') ? value.split(':', 2) : [input.text('kind', { optional: true, max: 10 }) || 'team', value]
  insist(kind === 'team' || kind === 'audience', 'invalid_kind')
  const group = await one(env, `SELECT * FROM (${GROUPS}) WHERE kind = ?2 AND id = ?3`, actor.id, kind, id)
  insist(group, 'group_not_found', 404)
  insist(actor.owner || (group.unit && actor.adminUnits.includes(group.unit)), 'forbidden', 403)
  return group
}

export async function setPoints(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const lessonPoints = input.integer('lessonPoints', { max: 1000 })!, coursePoints = input.integer('coursePoints', { max: 10_000 })!
  await commit(env, [stmt(env, `INSERT INTO beam_recognition_settings (id, lesson_points, course_points, updated_by, updated_at) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET lesson_points = excluded.lesson_points, course_points = excluded.course_points, updated_by = excluded.updated_by, updated_at = excluded.updated_at`, lessonPoints, coursePoints, actor.id, now())],
  { actor, action: 'recognition.points', subject: 'recognition', detail: { lessonPoints, coursePoints } })
  return { lessonPoints, coursePoints }
}

export async function saveBadge(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const name = input.text('name', { max: 80 }), description = input.text('description', { max: 300 }), milestone = input.text('milestone')
  insist(milestone === 'course' || milestone === 'courses', 'invalid_milestone')
  const course = milestone === 'course' ? input.text('course', { max: 64 }) : null
  const courses = milestone === 'courses' ? input.integer('courses', { min: 1, max: 500 }) : null
  if (course) insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id = ?', course), 'course_not_found', 404)
  const id = newId()
  await commit(env, [stmt(env, "INSERT INTO beam_badges (id, name, description, milestone, course_id, courses, state, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)", id, name, description, milestone, course, courses, actor.id, now())],
    { actor, action: 'recognition.badge', subject: id, detail: { name, milestone, course, courses } })
  return { id }
}

/** A retired badge is no longer shown or earned; nothing it recognized is recorded anywhere else. */
export async function retireBadge(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const id = input.text('badge', { max: 64 })
  insist(await one(env, "SELECT 1 FROM beam_badges WHERE id = ? AND state = 'active'", id), 'badge_not_found', 404)
  await commit(env, [stmt(env, "UPDATE beam_badges SET state = 'retired' WHERE id = ?", id)], { actor, action: 'recognition.badge.retire', subject: id })
  return { id }
}

export async function setGroupRecognition(env: Bindings, actor: Actor, input: Input) {
  const group = await requireGroupAdministrator(env, actor, input)
  const levels = yes(input, 'levels'), leaderboard = yes(input, 'leaderboard')
  const levelPoints = input.integer('levelPoints', { min: 1, max: 100_000, optional: !levels }) ?? 100
  await commit(env, [stmt(env, `INSERT INTO beam_group_recognition (kind, group_id, levels, level_points, leaderboard, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind, group_id) DO UPDATE SET levels = excluded.levels, level_points = excluded.level_points, leaderboard = excluded.leaderboard, updated_by = excluded.updated_by, updated_at = excluded.updated_at`, group.kind, group.id, levels ? 1 : 0, levelPoints, leaderboard ? 1 : 0, actor.id, now())],
  { actor, action: 'recognition.group', subject: group.id, detail: { kind: group.kind, levels, levelPoints, leaderboard } })
  return { kind: group.kind, group: group.id, levels, levelPoints, leaderboard }
}

/** A challenge counts the group's course completions recorded from the start of its first day to the end of its last day
 * in the business's time zone. */
export async function saveChallenge(env: Bindings, actor: Actor, input: Input) {
  const group = await requireGroupAdministrator(env, actor, input)
  const name = input.text('name', { max: 120 }), goal = input.integer('goal', { min: 1, max: 100_000 })!
  const startsOn = input.text('startsOn', { max: 10 }), endsOn = input.text('endsOn', { max: 10 })
  const zone = (await requireBusiness(env)).timezone
  const startsAt = zonedInstant(startsOn, '00:00', zone), endsAt = zonedInstant(addDays(endsOn, 1), '00:00', zone)
  insist(endsOn >= startsOn, 'challenge_ends_before_start')
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_challenges (id, kind, group_id, name, goal, starts_on, ends_on, starts_at, ends_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, group.kind, group.id, name, goal, startsOn, endsOn, startsAt, endsAt, actor.id, now())],
    { actor, action: 'recognition.challenge', subject: id, detail: { kind: group.kind, group: group.id, name, goal, startsOn, endsOn } })
  return { id }
}

/** A person's answer to the recognition notice, or a later change of mind: shown on leaderboards and counted toward
 * challenges, or left out of both. */
export async function setVisibility(env: Bindings, actor: Actor, input: Input) {
  const visible = yes(input, 'visible')
  await commit(env, [stmt(env, `INSERT INTO beam_recognition_choices (member_id, choice, decided_at) VALUES (?, ?, ?)
    ON CONFLICT(member_id) DO UPDATE SET choice = excluded.choice, decided_at = excluded.decided_at`, actor.id, visible ? 'in' : 'out', now())],
  { actor, action: 'recognition.visibility', subject: actor.id, detail: { visible } })
  return { visible }
}

interface Activity { lessons: number; courses: number; points: number; completions: { course: string; at: number }[] }

/** Each person's distinct finished lessons and the first completion of each distinct course, with their points. */
async function activity(env: Bindings, people: string[], settings: { lessonPoints: number; coursePoints: number }) {
  const list = JSON.stringify(people)
  const [lessons, completions] = await Promise.all([
    all(env, 'SELECT a.learner_id AS learner, COUNT(DISTINCT p.lesson_revision_id) AS n FROM beam_lesson_progress p JOIN beam_assignments a ON a.id = p.assignment_id WHERE a.learner_id IN (SELECT value FROM json_each(?)) GROUP BY a.learner_id', list),
    all(env, 'SELECT learner_id AS learner, course_id AS course, MIN(completed_at) AS at FROM beam_completions WHERE learner_id IN (SELECT value FROM json_each(?)) GROUP BY learner_id, course_id ORDER BY at', list),
  ])
  const result = new Map<string, Activity>(people.map(id => [id, { lessons: 0, courses: 0, points: 0, completions: [] }]))
  for (const row of lessons) result.get(row.learner)!.lessons = row.n
  for (const row of completions) result.get(row.learner)!.completions.push({ course: row.course, at: row.at })
  for (const value of result.values()) { value.courses = value.completions.length; value.points = value.lessons * settings.lessonPoints + value.courses * settings.coursePoints }
  return result
}

/** The badges a person holds, each with the instant its milestone was reached. */
function earned(badges: Row[], mine: Activity) {
  return badges.flatMap(badge => {
    const at = badge.milestone === 'course' ? mine.completions.find(item => item.course === badge.courseId)?.at : mine.completions[badge.courses - 1]?.at
    return at ? [{ id: badge.id, name: badge.name, description: badge.description, earnedAt: at }] : []
  })
}

export const level = (points: number, levelPoints: number) => 1 + Math.floor(points / levelPoints)

/** Settings, badges, the person's own recognition, the leaderboards and challenges of their groups, and what they may configure. */
export async function recognitionView(env: Bindings, actor: Actor) {
  const zone = (await requireBusiness(env)).timezone
  const [settingsRow, badges, choice, groups] = await Promise.all([
    one(env, 'SELECT lesson_points, course_points FROM beam_recognition_settings WHERE id = 1'),
    all(env, "SELECT b.id, b.name, b.description, b.milestone, b.course_id AS courseId, b.courses, c.title AS courseTitle FROM beam_badges b LEFT JOIN beam_courses c ON c.id = b.course_id WHERE b.state = 'active' ORDER BY b.created_at, b.rowid"),
    one(env, 'SELECT choice FROM beam_recognition_choices WHERE member_id = ?', actor.id),
    all(env, `SELECT g.*, r.levels, r.level_points AS levelPoints, r.leaderboard FROM (${GROUPS}) g LEFT JOIN beam_group_recognition r ON r.kind = g.kind AND r.group_id = g.id ORDER BY g.kind DESC, g.name`, actor.id),
  ])
  const settings = { lessonPoints: settingsRow?.lesson_points ?? 0, coursePoints: settingsRow?.course_points ?? 0 }
  // A group's recognition is seen by its members, the owner, its unit's learning administrators and a team's managers.
  const administers = (group: Row) => actor.owner || (!!group.unit && actor.adminUnits.includes(group.unit))
  const visible = groups.filter(group => group.member || administers(group) || (group.kind === 'team' && actor.teams?.includes(group.id)))
  const configurable = groups.filter(administers)
  const key = (kind: string, id: string) => `${kind}:${id}`
  const keys = JSON.stringify([...new Set([...visible, ...configurable].map(group => key(group.kind, group.id)))])
  const [members, challenges] = await Promise.all([
    all(env, `SELECT g.kind, g.groupId, m.id, m.name, (SELECT x.choice FROM beam_recognition_choices x WHERE x.member_id = m.id) AS choice FROM (${GROUP_MEMBERS}) g JOIN beam_members m ON m.id = g.member
      WHERE g.kind || ':' || g.groupId IN (SELECT value FROM json_each(?)) AND ${ACTIVE_MEMBER} ORDER BY m.name`, keys),
    all(env, "SELECT id, kind, group_id AS groupId, name, goal, starts_on AS startsOn, ends_on AS endsOn, starts_at AS startsAt, ends_at AS endsAt FROM beam_challenges WHERE kind || ':' || group_id IN (SELECT value FROM json_each(?)) ORDER BY starts_on, rowid", keys),
  ])
  const scores = await activity(env, [...new Set([actor.id, ...members.map(row => row.id)])], settings)
  const counted = await all(env, `SELECT ch.id, COUNT(c.id) AS n FROM beam_challenges ch JOIN (${GROUP_MEMBERS}) g ON g.kind = ch.kind AND g.groupId = ch.group_id JOIN beam_members m ON m.id = g.member
    JOIN beam_completions c ON c.learner_id = m.id AND c.completed_at >= ch.starts_at AND c.completed_at < ch.ends_at
    WHERE ch.id IN (SELECT value FROM json_each(?)) AND ${ACTIVE_MEMBER} AND NOT EXISTS (SELECT 1 FROM beam_recognition_choices x WHERE x.member_id = m.id AND x.choice = 'out') GROUP BY ch.id`, JSON.stringify(challenges.map(row => row.id)))
  const progress = new Map(counted.map(row => [row.id, row.n as number]))
  const at = now()
  const mine = scores.get(actor.id)!
  const groupView = (group: Row) => {
    const roster = members.filter(row => row.kind === group.kind && row.groupId === group.id)
    const board = group.leaderboard ? roster.filter(row => row.choice === 'in').map(row => {
      const score = scores.get(row.id)!
      return { member: row.id as string, name: row.name as string, lessons: score.lessons, courses: score.courses, points: score.points, badges: earned(badges, score).length, level: group.levels ? level(score.points, group.levelPoints) : null }
    }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)) : null
    return {
      kind: group.kind as string, id: group.id as string, name: group.name as string, levels: !!group.levels, levelPoints: group.levelPoints ?? null, leaderboard: board, leaderboardLabel: board ? LEADERBOARD_LABEL : null,
      challenges: challenges.filter(row => row.kind === group.kind && row.groupId === group.id).map(row => ({ id: row.id as string, name: row.name as string, goal: row.goal as number, startsOn: row.startsOn as string, endsOn: row.endsOn as string, completions: progress.get(row.id) ?? 0, met: (progress.get(row.id) ?? 0) >= row.goal, state: at < row.startsAt ? 'upcoming' : at >= row.endsAt ? 'ended' : 'running' })),
    }
  }
  return {
    zone, settings, badges, label: LEADERBOARD_LABEL,
    me: { choice: (choice?.choice ?? null) as string | null, visible: choice?.choice === 'in', noticeDue: !choice && groups.some(group => group.member && group.leaderboard), lessons: mine.lessons, courses: mine.courses, points: mine.points, badges: earned(badges, mine), levels: groups.filter(group => group.member && group.levels).map(group => ({ kind: group.kind as string, group: group.id as string, groupName: group.name as string, level: level(mine.points, group.levelPoints), levelPoints: group.levelPoints as number })) },
    groups: visible.map(groupView),
    configurable: configurable.map(group => ({ kind: group.kind as string, id: group.id as string, name: group.name as string, levels: !!group.levels, levelPoints: group.levelPoints ?? 100, leaderboard: !!group.leaderboard })),
    canSetPoints: actor.owner,
  }
}

export type RecognitionView = Awaited<ReturnType<typeof recognitionView>>
