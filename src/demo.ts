// Demo data for `rer demo` and the hosted demo (modules/demo runs it once, after
// the owner exists). Harbour Physio, the clinic Beam's flow tests train: its
// staff and teams, owned procedures, published courses and role paths, and a
// few weeks of learning: work in progress, overdue courses, exhausted quiz
// attempts, evidence waiting for its assessor (one for the owner), renewals
// coming due, revisions and a procedure change to review, and the owner's own
// week of assigned, overdue and completed learning. Fixed ids with INSERT OR IGNORE keep it
// idempotent; every date follows `now`. It never fetches.
import type { Bindings } from './auth.server'
import { payloadDigest } from './beam/agent-work'
import { sha256Hex } from './beam/core'
import { DAY, localDate, zonedInstant } from './beam/time'

const BUSINESS = 'Harbour Physio', ZONE = 'Australia/Sydney', OWNER_NAME = 'Olivia Hart'
// UUID-shaped ids; the first segment varies, so certificate numbers do too.
const id = (kind: string, n: number) => `${kind}${String(n).padStart(6, '0')}-5eed-4b3a-8d3e-0000000000de`

const STAFF = {
  ana: ['Ana Ruiz', 'ana.ruiz', ['author', 'learner']],
  priya: ['Priya Shah', 'priya.shah', ['reviewer', 'learner']],
  tom: ['Tom Okafor', 'tom.okafor', ['manager', 'assessor', 'learner']],
  noah: ['Noah Patel', 'noah.patel', ['author', 'learner']],
  mia: ['Mia Chen', 'mia.chen', ['learner']],
  sam: ['Sam Lee', 'sam.lee', ['learner']],
  lee: ['Lee Park', 'lee.park', ['learner']],
  jordan: ['Jordan Blake', 'jordan.blake', ['learner']],
  grace: ['Grace Kim', 'grace.kim', ['learner']],
  ella: ['Ella Novak', 'ella.novak', ['learner']],
} as const
type Person = keyof typeof STAFF | 'owner'

const SOURCES = [
  { key: 'opening', title: 'Opening procedure', licence: 'owned', evidence: 'Written by Tom Okafor, practice manager, March 2024.', versions: [
    { at: -120, file: 'opening-procedure.txt', provenance: 'Clinic shared drive, Procedures/Opening.docx exported as text', text: 'Opening procedure\n\n1. Disarm the alarm within 30 seconds of entry.\n2. Check the vaccine fridge and record the temperature in the fridge log.\n3. Turn on the treatment room heat packs and the front desk computers.\n4. Unlock the front door at 7:55.\n' },
    { at: -3, file: 'opening-procedure.txt', provenance: 'Updated after the October fridge audit', text: 'Opening procedure\n\n1. Disarm the alarm within 30 seconds of entry.\n2. Check the vaccine fridge: record the minimum, maximum and current temperature, and reset the min/max.\n3. If any reading is outside 2-8 °C, quarantine the stock and call the practice manager.\n4. Turn on the treatment room heat packs and the front desk computers.\n5. Unlock the front door at 7:55.\n' }] },
  { key: 'privacy', title: 'Client records and privacy policy', licence: 'owned', evidence: 'Harbour Physio policy, approved by the owner in January 2025.', versions: [
    { at: -200, file: 'privacy-policy.txt', provenance: 'Policies folder, Privacy v3 (PDF text)', text: 'Client records and privacy\n\nClient notes live only in the practice system. Never email notes or photograph screens. Confirm two identifiers before discussing a client. Requests for records go to the practice manager within one business day.\n' }] },
  { key: 'hygiene', title: 'Hand hygiene procedure', licence: 'permission', evidence: 'Adapted with written permission from the regional health network (email of 12 Feb 2025, filed in Admin/Permissions).', versions: [
    { at: -420, file: 'hand-hygiene.txt', provenance: 'Regional health network template, adapted for the clinic', text: 'Hand hygiene: the five moments\n\n1. Before touching a client.\n2. Before a clean or aseptic procedure.\n3. After body fluid exposure risk.\n4. After touching a client.\n5. After touching a client\'s surroundings.\n\nUse alcohol rub for 20-30 seconds; wash with soap and water when hands are visibly soiled.\n' }] },
  { key: 'fire', title: 'Fire evacuation plan', licence: 'owned', evidence: 'Prepared with Coastal Fire Safety for the building, 2025.', versions: [
    { at: -300, file: 'fire-evacuation-plan.txt', provenance: 'Building manager, evacuation diagram and procedure', text: 'Fire evacuation plan\n\nOn the alarm: stop treatment, help clients to the nearest exit, close doors behind you. Assemble at the car park sign by the pharmacy. The front desk brings the day list and checks every client and staff member off.\n' }] },
  { key: 'fridge', title: 'Fridge temperature log template', licence: 'owned', evidence: 'Clinic form, designed by Tom Okafor.', versions: [
    { at: -120, file: 'fridge-log-template.txt', provenance: 'Forms folder, Fridge log v2', text: 'Date | Time | Current °C | Min °C | Max °C | Reset | Initials\n' }] },
  { key: 'lifting', title: 'Safe lifting guide', licence: 'licensed', evidence: 'Licensed from the SafeWork training pack, invoice INV-20431, five seats.', versions: [
    { at: -20, file: 'safe-lifting-guide.txt', provenance: 'SafeWork training pack, chapter 2', text: 'Safe lifting\n\nPlan the move, use a slide sheet or hoist when the client cannot assist, keep the load close, and never twist while lifting.\n' }] },
] as const
type SourceKey = typeof SOURCES[number]['key']

interface LessonData { title: string; body: string; sources?: SourceKey[] }
interface QuestionData { prompt: string; choices: string[]; correct: number[] }
interface CourseData {
  key: string; title: string; summary: string; author: Person; reviewer: Person; createdAt: number
  lessons: LessonData[]; questions?: QuestionData[]; passPercent?: number; maxAttempts?: number; practical?: string; assessor?: Person
  // Revisions, oldest first; the last published one is current.
  revisions: { state: 'returned' | 'published' | 'in_review'; at: number; note?: string; lessons?: number }[]
}

const COURSES: CourseData[] = [
  { key: 'opening', title: 'Opening the clinic', summary: 'How we open each morning, safely and on time.', author: 'ana', reviewer: 'priya', createdAt: -110,
    lessons: [
      { title: 'Before you arrive', body: 'Check the roster the night before so you know who opens with you.\n\n- Keys and the alarm fob are in the lockbox by the back door.\n- The alarm code changes on the first of each month; Tom sends it.' },
      { title: 'Opening steps', body: 'Follow the opening procedure in order. The fridge check is not optional: a missed reading means the stock is quarantined until the practice manager clears it.', sources: ['opening'] },
      { title: 'The fridge log', body: 'Record the current, minimum and maximum temperature, then reset the min/max. Anything outside 2-8 °C: stop, quarantine the stock and call Tom.', sources: ['fridge'] },
    ],
    questions: [
      { prompt: 'What do you do first when you open the clinic?', choices: ['Disarm the alarm', 'Unlock the front door', 'Turn on the computers'], correct: [0] },
      { prompt: 'Which readings go in the fridge log?', choices: ['Current temperature', 'Weather outside', 'Minimum and maximum since the last reset'], correct: [0, 2] },
    ],
    passPercent: 100, maxAttempts: 2, practical: 'Open the clinic with your assessor watching: alarm, fridge log, heat packs and front door.',
    revisions: [{ state: 'returned', at: -100, note: 'Name the fridge log in the opening steps, and add the reading range.', lessons: 2 }, { state: 'published', at: -90 }] },
  { key: 'records', title: 'Handling client records', summary: 'Where client information lives, who may see it and how to answer a records request.', author: 'ana', reviewer: 'priya', createdAt: -190,
    lessons: [
      { title: 'Where records live', body: 'Client notes, images and letters live only in the practice system. Never keep copies in email, on phones or on paper at the desk.', sources: ['privacy'] },
      { title: 'Checking identity', body: 'Before discussing a client, on the phone or at the desk, confirm two identifiers: full name and date of birth, or full name and address.', sources: ['privacy'] },
    ],
    questions: [
      { prompt: 'Where may client notes be kept?', choices: ['In the practice system only', 'In your work email', 'On the desk in a folder'], correct: [0] },
      { prompt: 'A caller asks about their appointment. What do you confirm first?', choices: ['Two identifiers', 'Their phone number only', 'Nothing, they called the clinic'], correct: [0] },
      { prompt: 'Who handles a request for a copy of records?', choices: ['Whoever answers the phone', 'The practice manager, within one business day', 'The treating physio, whenever convenient'], correct: [1] },
    ],
    passPercent: 60, maxAttempts: 3,
    revisions: [{ state: 'published', at: -185 }] },
  { key: 'hygiene', title: 'Hand hygiene and infection control', summary: 'The five moments, rub or wash, and cleaning between clients.', author: 'noah', reviewer: 'priya', createdAt: -415,
    lessons: [
      { title: 'The five moments', body: 'Clean your hands before touching a client, before a clean procedure, after body fluid risk, after touching a client and after touching their surroundings.', sources: ['hygiene'] },
      { title: 'Rub or wash', body: 'Alcohol rub for 20-30 seconds is the default. Wash with soap and water when your hands are visibly soiled.', sources: ['hygiene'] },
      { title: 'Between clients', body: 'Wipe the plinth, pillows and any equipment you used with the detergent wipes, then change the paper roll.' },
    ],
    questions: [
      { prompt: 'When must you clean your hands?', choices: ['Before touching a client', 'After touching a client\'s surroundings', 'Only when they look dirty'], correct: [0, 1] },
      { prompt: 'Your hands are visibly soiled. What do you use?', choices: ['Alcohol rub', 'Soap and water'], correct: [1] },
    ],
    passPercent: 100, maxAttempts: 3,
    revisions: [{ state: 'published', at: -410 }] },
  { key: 'fire', title: 'Fire and emergency evacuation', summary: 'What to do when the alarm sounds, and who checks everyone is out.', author: 'ana', reviewer: 'priya', createdAt: -290,
    lessons: [
      { title: 'When the alarm sounds', body: 'Stop treatment, help your client to the nearest exit and close doors behind you. Do not collect belongings.', sources: ['fire'] },
      { title: 'Assembly and roll call', body: 'Assemble at the car park sign by the pharmacy. The front desk brings the day list and checks every client and staff member off.', sources: ['fire'] },
    ],
    revisions: [{ state: 'published', at: -285 }] },
  { key: 'lifting', title: 'Manual handling for clinicians', summary: 'Moving clients safely, with the equipment we have.', author: 'noah', reviewer: 'priya', createdAt: -18,
    lessons: [
      { title: 'Plan the move', body: 'Ask what the client can do themselves. If they cannot assist, use the slide sheet or the hoist; never lift a client alone.', sources: ['lifting'] },
      { title: 'Your back', body: 'Keep the load close, bend your knees, and never twist while lifting.', sources: ['lifting'] },
    ],
    questions: [{ prompt: 'A client cannot assist with a transfer. What do you use?', choices: ['A slide sheet or the hoist', 'A colleague and a quick lift'], correct: [0] }],
    passPercent: 100, maxAttempts: 2,
    revisions: [{ state: 'in_review', at: -2 }] },
  { key: 'reset', title: 'Treatment room reset', summary: 'Getting a room ready for the next client in five minutes.', author: 'ana', reviewer: 'priya', createdAt: -6,
    lessons: [{ title: 'The five-minute reset', body: 'Wipe down, fresh paper, pillows squared, equipment back on the trolley, bin emptied if more than half full.' }],
    revisions: [] },
  { key: 'payments', title: 'Payments, refunds and receipts', summary: 'Taking payment at the desk, health fund claims, and refunds the right way.', author: 'ana', reviewer: 'owner', createdAt: -70,
    lessons: [
      { title: 'Taking payment', body: 'Check the invoice with the client before you take payment. Card payments go through the terminal at the desk; cash goes in the till and is counted at close.' },
      { title: 'Health fund claims', body: 'Swipe the client\'s health fund card on the terminal before the payment card, and give them both receipts.' },
      { title: 'Refunds', body: 'Refunds go back to the card that paid, never as cash. Note the reason on the invoice and tell the practice manager the same day.' },
    ],
    practical: 'Take a payment with a health fund claim, then process a refund, with your assessor watching.', assessor: 'owner',
    revisions: [{ state: 'published', at: -60 }, { state: 'in_review', at: -1 }] },
]
type CourseKey = 'opening' | 'records' | 'hygiene' | 'fire' | 'lifting' | 'reset' | 'payments'

const TEAMS = { frontdesk: ['Front desk', ['sam', 'lee', 'jordan', 'grace']], clinicians: ['Clinicians', ['owner', 'mia', 'noah', 'priya', 'tom']] } as const
const PATHS = {
  frontdesk: { name: 'Front desk onboarding', team: 'frontdesk', at: -60, requirements: [{ course: 'opening', dueDays: 7 }, { course: 'records', prerequisite: 'opening', dueDays: 14, renewalDays: 365 }] },
  clinicians: { name: 'Clinician essentials', team: 'clinicians', at: -430, requirements: [{ course: 'hygiene', dueDays: 7, renewalDays: 365 }, { course: 'fire', dueDays: 14, renewalDays: 730 }] },
} as const

// Each assignment: learner, course, due (days from now), when it was assigned, its path, and what the learner has done.
interface AssignmentData {
  n: number; learner: Person; course: CourseKey; due: number; assigned: number; path?: keyof typeof PATHS; reason?: string
  lessonsDone?: number; quiz?: { at: number; answers: number[][] }[]; practical?: { at: number; evidence: string; decided?: { at: number; note: string } }
  completed?: { at: number; method: 'assessed' | 'lessons' | 'offline'; session?: number }
}
const ASSIGNMENTS: AssignmentData[] = [
  { n: 1, learner: 'sam', course: 'opening', due: 5, assigned: -2, path: 'frontdesk', lessonsDone: 1 },
  { n: 2, learner: 'sam', course: 'records', due: 12, assigned: -2, path: 'frontdesk' },
  { n: 3, learner: 'lee', course: 'opening', due: -33, assigned: -40, path: 'frontdesk', lessonsDone: 3, quiz: [{ at: -37, answers: [[0], [0, 2]] }],
    practical: { at: -36, evidence: 'Opened on Monday with Tom: alarm off at 7:41, fridge 4.2 °C (min 3.8, max 5.1) logged and reset, heat packs on, door unlocked at 7:55.', decided: { at: -35, note: 'Observed the full opening. Fridge log filled in correctly.' } },
    completed: { at: -35, method: 'assessed' } },
  { n: 4, learner: 'lee', course: 'records', due: -3, assigned: -40, path: 'frontdesk', lessonsDone: 1 },
  { n: 5, learner: 'jordan', course: 'opening', due: 2, assigned: -9, path: 'frontdesk', lessonsDone: 3, quiz: [{ at: -3, answers: [[1], [0, 2]] }, { at: -1, answers: [[0], [0]] }] },
  { n: 6, learner: 'grace', course: 'opening', due: 4, assigned: -9, path: 'frontdesk', lessonsDone: 3, quiz: [{ at: -2, answers: [[0], [0, 2]] }],
    practical: { at: -1, evidence: 'Opened on Thursday with Tom watching. Alarm disarmed, fridge 4 °C (min 3.6, max 4.9) logged at 7:52, heat packs on, door open 7:55.' } },
  { n: 7, learner: 'mia', course: 'hygiene', due: -393, assigned: -400, path: 'clinicians', lessonsDone: 3, quiz: [{ at: -396, answers: [[0, 1], [1]] }], completed: { at: -396, method: 'assessed' } },
  { n: 8, learner: 'mia', course: 'fire', due: -16, assigned: -30, path: 'clinicians', lessonsDone: 2, completed: { at: -26, method: 'lessons' } },
  { n: 9, learner: 'noah', course: 'hygiene', due: 10, assigned: -4, path: 'clinicians', reason: 'renewal', lessonsDone: 2 },
  { n: 10, learner: 'noah', course: 'fire', due: -50, assigned: -64, path: 'clinicians', completed: { at: -60, method: 'offline', session: 2 } },
  { n: 11, learner: 'priya', course: 'hygiene', due: -95, assigned: -102, path: 'clinicians', lessonsDone: 3, quiz: [{ at: -101, answers: [[0], [1]] }, { at: -100, answers: [[0, 1], [1]] }], completed: { at: -100, method: 'assessed' } },
  { n: 12, learner: 'priya', course: 'fire', due: 20, assigned: -6, path: 'clinicians' },
  { n: 13, learner: 'tom', course: 'hygiene', due: -195, assigned: -202, path: 'clinicians', lessonsDone: 3, quiz: [{ at: -200, answers: [[0, 1], [1]] }], completed: { at: -200, method: 'assessed' } },
  { n: 14, learner: 'tom', course: 'fire', due: -2, assigned: -16, path: 'clinicians', lessonsDone: 1 },
  { n: 15, learner: 'ana', course: 'records', due: -40, assigned: -50, completed: { at: -45, method: 'offline', session: 1 } },
  { n: 16, learner: 'ana', course: 'fire', due: -10, assigned: -20, lessonsDone: 2, completed: { at: -15, method: 'lessons' } },
  { n: 17, learner: 'owner', course: 'fire', due: 7, assigned: -1, lessonsDone: 1 },
  { n: 18, learner: 'mia', course: 'records', due: 9, assigned: -5 },
  { n: 19, learner: 'owner', course: 'records', due: -40, assigned: -50, completed: { at: -45, method: 'offline', session: 1 } },
  { n: 20, learner: 'owner', course: 'hygiene', due: -361, assigned: -370, path: 'clinicians', lessonsDone: 3, quiz: [{ at: -363, answers: [[0, 1], [1]] }], completed: { at: -363, method: 'assessed' } },
  { n: 21, learner: 'owner', course: 'hygiene', due: 2, assigned: -11, path: 'clinicians', reason: 'renewal', lessonsDone: 2 },
  { n: 22, learner: 'owner', course: 'opening', due: -1, assigned: -12, lessonsDone: 2 },
  { n: 23, learner: 'lee', course: 'payments', due: -20, assigned: -50, lessonsDone: 3,
    practical: { at: -45, evidence: 'Took a $95 payment with a Medibank claim for a standard consult and refunded a duplicate $20 charge to the paying card, with the owner at the desk.', decided: { at: -44, note: 'Claim before payment, both receipts given, refund to the card with the reason noted.' } },
    completed: { at: -44, method: 'assessed' } },
  { n: 24, learner: 'sam', course: 'payments', due: 6, assigned: -8, lessonsDone: 3,
    practical: { at: -1, evidence: 'Wednesday afternoon: took payment for a follow-up with an HCF claim (gap $38.50), printed both receipts, then refunded a cancelled class to the original card and noted the reason on the invoice.' } },
  { n: 25, learner: 'jordan', course: 'payments', due: 13, assigned: -3, lessonsDone: 1 },
]
const SESSIONS = {
  1: { course: 'records', held: -45, instructor: 'Karen Doyle, privacy consultant', location: 'Harbour Physio meeting room', attestation: 'Ana and Olivia attended the full two-hour privacy refresher and completed the case exercises.' },
  2: { course: 'fire', held: -60, instructor: 'Hugh Mercer, Coastal Fire Safety', location: 'Harbour Physio, car park assembly point', attestation: 'Noah took part in the building evacuation drill and the warden briefing.' },
} as const

export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }): Promise<void> {
  const db = env.DB, at = (days: number, hours = 0) => now.getTime() + days * DAY + hours * 3_600_000
  const q = (sql: string, ...values: unknown[]) => db.prepare(sql).bind(...values)
  const owner = await db.prepare("SELECT id, display_name FROM oa_operators WHERE email = ? AND role = 'owner'").bind(ownerEmail).first<{ id: string; display_name: string }>()
  if (!owner) return
  // The owner's Beam membership may already exist from a first page view; keep its id.
  // A demo owner arrives with a placeholder name; the clinic's owner has her own.
  const generic = (name: string | null) => !name || name.trim().toLowerCase() === 'owner'
  const ownerName = generic(owner.display_name) ? OWNER_NAME : owner.display_name
  await q('INSERT INTO beam_members (id, email, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING', id('a0', 0), ownerEmail, ownerName, at(-500)).run()
  await q("UPDATE beam_members SET name = ? WHERE email = ? AND (name = '' OR lower(name) = 'owner')", ownerName, ownerEmail).run()
  if (generic(owner.display_name)) await q('UPDATE oa_operators SET display_name = ? WHERE id = ?', ownerName, owner.id).run()
  const ownerMember = (await q('SELECT id FROM beam_members WHERE email = ?', ownerEmail).first<{ id: string }>())!.id
  const member = (person: Person) => person === 'owner' ? ownerMember : id('a0', Object.keys(STAFF).indexOf(person) + 1)
  const emailOf = (person: keyof typeof STAFF) => `${STAFF[person][1]}@harbour-physio.example`
  const due = (days: number) => { const date = localDate(at(days), ZONE); return { date, at: zonedInstant(date, '17:00', ZONE) } }

  const statements: D1PreparedStatement[] = [
    q('INSERT INTO oa_first_run (singleton, completed_by, completed_at) VALUES (1, ?, ?) ON CONFLICT(singleton) DO NOTHING', owner.id, at(-500)),
    q('INSERT OR IGNORE INTO beam_business (singleton, name, timezone, updated_at) VALUES (1, ?, ?, ?)', BUSINESS, ZONE, at(-500)),
    ...['author', 'reviewer', 'learner', 'manager', 'assessor'].map(role => q('INSERT OR IGNORE INTO beam_member_roles (member_id, role) VALUES (?, ?)', ownerMember, role)),
  ]
  // Staff: real member accounts (Ella's access was removed when she left), each a Beam member with roles.
  Object.entries(STAFF).forEach(([key, [name, , roles]], index) => {
    const joined = at(-480 + index * 30)
    statements.push(
      q("INSERT OR IGNORE INTO oa_operators (id, email, display_name, role, status, created_at) VALUES (?, ?, ?, 'member', ?, ?)", id('a1', index + 1), emailOf(key as keyof typeof STAFF), name, key === 'ella' ? 'inactive' : 'active', joined),
      q('INSERT OR IGNORE INTO beam_members (id, email, name, created_at) VALUES (?, ?, ?, ?)', member(key as Person), emailOf(key as keyof typeof STAFF), name, joined),
      ...roles.map(role => q('INSERT OR IGNORE INTO beam_member_roles (member_id, role) VALUES (?, ?)', member(key as Person), role)),
    )
  })
  Object.entries(TEAMS).forEach(([, [name, people]], index) => {
    statements.push(q('INSERT OR IGNORE INTO beam_teams (id, name, created_at) VALUES (?, ?, ?)', id('a2', index + 1), name, at(-470)))
    for (const person of people) statements.push(q('INSERT OR IGNORE INTO beam_team_members (team_id, member_id) VALUES (?, ?)', id('a2', index + 1), member(person)))
  })
  const team = (key: keyof typeof TEAMS) => id('a2', Object.keys(TEAMS).indexOf(key) + 1)

  // Owned sources: bytes in FILES by content hash, as sources.ts stores them.
  const versions = new Map<string, string[]>()
  let versionNumber = 0
  for (const [index, source] of SOURCES.entries()) {
    const sourceId = id('b0', index + 1)
    statements.push(q('INSERT OR IGNORE INTO beam_sources (id, title, licence, licence_evidence, reviewer_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', sourceId, source.title, source.licence, source.evidence, member('priya'), member(source.key === 'hygiene' || source.key === 'lifting' ? 'noah' : 'ana'), at(source.versions[0].at)))
    const ids: string[] = []
    for (const [number, version] of source.versions.entries()) {
      const bytes = new TextEncoder().encode(version.text), sha256 = await sha256Hex(bytes), versionId = id('b1', ++versionNumber)
      if (!await env.FILES.head(`sha256/${sha256}`)) await env.FILES.put(`sha256/${sha256}`, bytes, { httpMetadata: { contentType: 'application/octet-stream' } })
      statements.push(q("INSERT OR IGNORE INTO beam_source_versions (id, source_id, number, filename, media_type, size, sha256, provenance, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, 'text/plain', ?, ?, ?, ?, ?)", versionId, sourceId, number + 1, version.file, bytes.length, sha256, version.provenance, member(source.key === 'hygiene' || source.key === 'lifting' ? 'noah' : 'ana'), at(version.at)))
      ids.push(versionId)
    }
    versions.set(source.key, ids)
  }
  // Courses cite each source's first version; the opening procedure's newer version raises a notice.
  const cite = (lesson: LessonData) => (lesson.sources ?? []).map(key => versions.get(key)![0])

  const courseId = (key: CourseKey) => id('c0', COURSES.findIndex(course => course.key === key) + 1)
  const published = new Map<CourseKey, { revision: string; lessons: string[]; assessment: string | null; questions: { id: string; correct: number[] }[] }>()
  let revisionCount = 0, lessonCount = 0
  for (const [index, course] of COURSES.entries()) {
    const key = course.key as CourseKey, cid = courseId(key)
    const draftLessons = course.lessons.map((lesson, position) => ({ id: id('c1', index * 10 + position + 1), title: lesson.title, body: lesson.body, sources: cite(lesson) }))
    const questions = (course.questions ?? []).map((question, position) => ({ id: id('c2', index * 10 + position + 1), prompt: question.prompt, choices: question.choices, correct: question.correct }))
    const assessed = questions.length > 0 || !!course.practical
    const draft = { title: course.title, summary: course.summary, lessons: draftLessons, questions, passPercent: course.passPercent ?? null, maxAttempts: course.maxAttempts ?? null, practical: course.practical ? { instructions: course.practical, assessor: member(course.assessor ?? 'tom') } : null }
    const draftVersion = 3 + course.lessons.length * 2 + questions.length + course.revisions.length * 2
    const current = [...course.revisions.keys()].reverse().find(position => course.revisions[position].state === 'published')
    statements.push(q('INSERT OR IGNORE INTO beam_courses (id, title, reviewer_id, created_by, created_at, draft_json, draft_version, published_revision_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', cid, course.title, member(course.reviewer), member(course.author), at(course.createdAt), JSON.stringify(draft), draftVersion, current === undefined ? null : id('c3', revisionCount + current + 1)))
    for (const [number, revision] of course.revisions.entries()) {
      const rid = id('c3', ++revisionCount), lessons = draftLessons.slice(0, revision.lessons ?? draftLessons.length)
      const reviewed = revision.state === 'in_review' ? [null, null] : [member(course.reviewer), at(revision.at, 4)]
      statements.push(q('INSERT OR IGNORE INTO beam_course_revisions (id, course_id, number, title, summary, draft_version, state, submitted_by, submitted_at, reviewed_by, reviewed_at, review_note, reassignment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        rid, cid, number + 1, course.title, course.summary, draftVersion - (course.revisions.length - number) * 2, revision.state, member(course.author), at(revision.at), ...reviewed, revision.note ?? null, revision.state === 'published' ? 'none' : null))
      const lessonIds = lessons.map((lesson, position) => {
        const lid = id('c4', ++lessonCount)
        statements.push(q('INSERT OR IGNORE INTO beam_lesson_revisions (id, course_revision_id, position, title, body, source_version_ids) VALUES (?, ?, ?, ?, ?, ?)', lid, rid, position, lesson.title, lesson.body, JSON.stringify(lesson.sources)))
        return lid
      })
      const assessment = assessed ? id('c5', revisionCount) : null
      if (assessment) statements.push(q('INSERT OR IGNORE INTO beam_assessment_revisions (id, course_revision_id, questions_json, pass_percent, max_attempts, practical_instructions, assessor_id) VALUES (?, ?, ?, ?, ?, ?, ?)', assessment, rid, JSON.stringify(questions), draft.passPercent, draft.maxAttempts, course.practical ?? null, course.practical ? member(course.assessor ?? 'tom') : null))
      if (number === current) published.set(key, { revision: rid, lessons: lessonIds, assessment, questions })
    }
  }
  const opening = versions.get('opening')!
  statements.push(q("INSERT OR IGNORE INTO beam_source_notices (id, course_id, source_id, previous_version_id, new_version_id, state, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)", id('c6', 1), courseId('opening'), id('b0', 1), opening[0], opening[1], at(-3)))

  const pathRevision = new Map<keyof typeof PATHS, string>()
  Object.entries(PATHS).forEach(([key, path], index) => {
    const pid = id('d0', index + 1), revision = id('d1', index + 1)
    statements.push(
      q('INSERT OR IGNORE INTO beam_paths (id, name, team_id, current_revision_id, created_at) VALUES (?, ?, ?, ?, ?)', pid, path.name, team(path.team), revision, at(path.at)),
      q('INSERT OR IGNORE INTO beam_path_revisions (id, path_id, number, created_by, created_at) VALUES (?, ?, 1, ?, ?)', revision, pid, member('tom'), at(path.at)),
      ...path.requirements.map((requirement, position) => q('INSERT OR IGNORE INTO beam_path_requirements (path_revision_id, position, course_id, prerequisite_course_id, due_days, renewal_days) VALUES (?, ?, ?, ?, ?, ?)',
        revision, position, courseId(requirement.course), 'prerequisite' in requirement ? courseId(requirement.prerequisite) : null, requirement.dueDays, 'renewalDays' in requirement ? requirement.renewalDays : null)),
    )
    pathRevision.set(key as keyof typeof PATHS, revision)
  })

  for (const [key, session] of Object.entries(SESSIONS)) {
    const held = localDate(at(session.held), ZONE)
    statements.push(q('INSERT OR IGNORE INTO beam_offline_sessions (id, course_id, course_revision_id, held_on, instructor, location, attested_by, attestation, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id('e0', Number(key)), courseId(session.course), published.get(session.course)!.revision, held, session.instructor, session.location, member('tom'), session.attestation, at(session.held + 1)))
  }

  let attemptCount = 0
  for (const assignment of ASSIGNMENTS) {
    const course = published.get(assignment.course)!, aid = id('f0', assignment.n), when = due(assignment.due)
    const assessor = COURSES.find(item => item.key === assignment.course)!.assessor ?? 'tom'
    const requirement = assignment.path ? PATHS[assignment.path].requirements.find(item => item.course === assignment.course) : undefined
    const renewalDays = requirement && 'renewalDays' in requirement ? requirement.renewalDays : null
    const done = assignment.completed ? course.lessons.length : assignment.lessonsDone ?? 0
    statements.push(q("INSERT OR IGNORE INTO beam_assignments (id, learner_id, course_id, course_revision_id, path_revision_id, prerequisite_course_id, renewal_days, due_date, due_time, timezone, due_at, status, reason, last_lesson_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '17:00', ?, ?, ?, ?, ?, ?, ?)",
      aid, member(assignment.learner), courseId(assignment.course), course.revision, assignment.path ? pathRevision.get(assignment.path)! : null, requirement && 'prerequisite' in requirement ? courseId(requirement.prerequisite) : null, renewalDays,
      when.date, ZONE, when.at, assignment.completed ? 'completed' : 'open', assignment.reason ?? (assignment.path ? 'path' : 'assigned'), course.lessons[done] ?? null, member('tom'), at(assignment.assigned, 2)))
    course.lessons.slice(0, done).forEach((lesson, position) => statements.push(q('INSERT OR IGNORE INTO beam_lesson_progress (assignment_id, lesson_revision_id, completed_at) VALUES (?, ?, ?)', aid, lesson, at(assignment.assigned + 1 + position * 0.5, 9))))
    let quizAttempt: string | null = null, practicalAttempt: string | null = null
    const allowed = (COURSES.find(item => item.key === assignment.course)!.maxAttempts ?? 0)
    for (const [index, quiz] of (assignment.quiz ?? []).entries()) {
      const tid = id('f1', ++attemptCount)
      const responses = course.questions.map((question, position) => ({ question: question.id, selected: quiz.answers[position], correct: JSON.stringify(quiz.answers[position]) === JSON.stringify(question.correct) }))
      const points = responses.filter(response => response.correct).length, passPercent = COURSES.find(item => item.key === assignment.course)!.passPercent!
      const passed = Math.floor(points * 100 / responses.length) >= passPercent, left = allowed - index - 1
      const decision = passed ? 'passed' : left > 0 ? `retry allowed: ${left} attempt${left === 1 ? '' : 's'} remaining` : 'no attempts remaining: a manager may grant another attempt'
      if (passed) quizAttempt = tid
      statements.push(q("INSERT OR IGNORE INTO beam_attempts (id, assignment_id, assessment_revision_id, kind, number, submitted_at, score, max_score, passed, scoring_rule, retry_decision, state) VALUES (?, ?, ?, 'quiz', ?, ?, ?, ?, ?, ?, ?, 'scored')",
        tid, aid, course.assessment, index + 1, at(quiz.at, 10), points, responses.length, passed ? 1 : 0, `exact choice match per question; pass at ${passPercent}%`, decision),
        ...responses.map(response => q('INSERT OR IGNORE INTO beam_responses (attempt_id, question_id, answer_json, correct) VALUES (?, ?, ?, ?)', tid, response.question, JSON.stringify(response.selected), response.correct ? 1 : 0)))
    }
    if (assignment.practical) {
      const tid = id('f1', ++attemptCount), decided = assignment.practical.decided
      if (decided) practicalAttempt = tid
      statements.push(q("INSERT OR IGNORE INTO beam_attempts (id, assignment_id, assessment_revision_id, kind, number, submitted_at, passed, scoring_rule, retry_decision, state, evidence_text) VALUES (?, ?, ?, 'practical', 1, ?, ?, 'named assessor decision', ?, ?, ?)",
        tid, aid, course.assessment, at(assignment.practical.at, 11), decided ? 1 : null, decided ? 'accepted by the named assessor' : 'awaiting the named assessor', decided ? 'accepted' : 'awaiting_review', assignment.practical.evidence))
      if (decided) statements.push(q("INSERT OR IGNORE INTO beam_review_decisions (id, attempt_id, assessor_id, decision, note, decided_at) VALUES (?, ?, ?, 'accepted', ?, ?)", id('f2', attemptCount), tid, member(assessor), decided.note, at(decided.at, 12)))
    }
    if (assignment.completed) {
      const completion = id('f3', assignment.n), session = assignment.completed.session
      const completedAt = session ? zonedInstant(localDate(at(SESSIONS[session as 1 | 2].held), ZONE), '12:00', ZONE) : at(assignment.completed.at, 12)
      const expires = renewalDays ? completedAt + renewalDays * DAY : null
      const evidence = session ? { offlineSession: id('e0', session), instructor: SESSIONS[session as 1 | 2].instructor, attestedBy: member('tom'), attachment: null }
        : { lessons: course.lessons, quizAttempt, practicalAttempt }
      statements.push(
        q('INSERT OR IGNORE INTO beam_completions (id, assignment_id, learner_id, course_id, course_revision_id, assessment_revision_id, method, evidence_json, completed_at, expires_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          completion, aid, member(assignment.learner), courseId(assignment.course), course.revision, assignment.completed.method === 'assessed' ? course.assessment : null, assignment.completed.method, JSON.stringify(evidence), completedAt, expires,
          member(practicalAttempt ? assessor : session ? 'tom' : assignment.learner)),
        q('INSERT OR IGNORE INTO beam_certificates (id, completion_id, number, issuer, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', id('f4', assignment.n), completion, `${new Date(completedAt).getUTCFullYear()}-${completion.slice(0, 8).toUpperCase()}`, BUSINESS, completedAt, expires),
        q("INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, 'completion.record', ?, ? WHERE changes() = 1", completedAt, member(practicalAttempt ? assessor : session ? 'tom' : assignment.learner), completion, JSON.stringify({ assignment: aid, method: assignment.completed.method })),
      )
    }
  }

  // The clinic's own agent prepares reminders and plans through Tom's preparation credential; people decide.
  const AGENT = 'Harbour ops agent'
  const assignmentInput = (n: number) => { const a = ASSIGNMENTS.find(item => item.n === n)!; return { type: 'assignment', id: id('f0', n), label: `${a.learner === 'owner' ? ownerName : STAFF[a.learner][0]}'s ${COURSES.find(c => c.key === a.course)!.title} assignment` } }
  const PROPOSALS: { n: number; kind: 'reminders' | 'assignment_plan'; title: string; at: number; inputs: object[]; reasons: string[]; excluded: { item: string; reason: string }[]; payload: object; decided?: { state: 'approved' | 'declined'; by: Person; at: number; note: string; result: object | null } }[] = [
    { n: 1, kind: 'reminders', title: 'Reminders for two overdue courses', at: -0.2, inputs: [assignmentInput(4), assignmentInput(14)],
      reasons: ['Lee Park\'s Handling client records was due three days ago, with one of two lessons done.', 'Tom Okafor\'s Fire and emergency evacuation was due two days ago, with one of two lessons done.'],
      excluded: [{ item: 'Jordan Blake, Opening the clinic', reason: 'Out of quiz attempts: a manager decides on another attempt; a reminder would not help.' }],
      payload: { items: [
        { assignment: id('f0', 4), message: 'Hi Lee, Handling client records is now overdue. The second lesson (checking identity) takes about ten minutes; please finish it in paid time before Friday.' },
        { assignment: id('f0', 14), message: 'Hi Tom, your fire evacuation course is two days overdue. One lesson left: assembly and roll call.' }] } },
    { n: 2, kind: 'assignment_plan', title: 'Payments course for the rest of the front desk', at: -0.5, inputs: [{ type: 'course_revision', id: published.get('payments')!.revision, label: 'Payments, refunds and receipts revision 1' }],
      reasons: ['Grace Kim joined the front desk and has not been assigned Payments, refunds and receipts.', 'Sam and Jordan already have it; Lee completed it last month.'],
      excluded: [{ item: 'Clinicians', reason: 'Clinicians do not take payments at the desk.' }],
      payload: { items: [{ learner: member('grace'), course: courseId('payments'), courseRevision: published.get('payments')!.revision, dueDate: localDate(at(14), ZONE), dueTime: '17:00', timezone: ZONE }] } },
    { n: 3, kind: 'reminders', title: 'A nudge for Sam\'s opening course', at: -4, inputs: [assignmentInput(1)],
      reasons: ['Sam Lee opens with Tom next week and has one of three lessons of Opening the clinic done.'], excluded: [],
      payload: { items: [{ assignment: id('f0', 1), message: 'Hi Sam, you open with Tom on Tuesday. Please finish the opening steps and fridge log lessons before then.' }] },
      decided: { state: 'approved', by: 'owner', at: -3.8, note: 'Good timing.', result: { delivered: [id('f0', 1)], skipped: [] } } },
    { n: 4, kind: 'reminders', title: 'Hand hygiene renewal reminder for Noah', at: -3, inputs: [assignmentInput(9)],
      reasons: ['Noah Patel\'s hand hygiene renewal is due in ten days, with two of three lessons done.'], excluded: [],
      payload: { items: [{ assignment: id('f0', 9), message: 'Hi Noah, your hand hygiene renewal is due soon: one lesson left.' }] },
      decided: { state: 'declined', by: 'tom', at: -2.9, note: 'Noah is on leave until the 20th; it can wait until he is back.', result: null } },
  ]
  for (const proposal of PROPOSALS) {
    const pid = id('g0', proposal.n), decided = proposal.decided
    statements.push(q("INSERT OR IGNORE INTO beam_agent_proposals (id, kind, title, agent, prepared_by, via_agent, inputs_json, reasons_json, excluded_json, payload_json, payload_sha256, state, decided_by, decided_at, decision_note, result_json, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      pid, proposal.kind, proposal.title, AGENT, member('tom'), JSON.stringify(proposal.inputs), JSON.stringify(proposal.reasons), JSON.stringify(proposal.excluded), JSON.stringify(proposal.payload), await payloadDigest(proposal.payload),
      decided?.state ?? 'waiting', decided ? member(decided.by) : null, decided ? at(decided.at) : null, decided?.note ?? null, decided ? JSON.stringify(decided.result) : null, at(proposal.at)))
  }
  statements.push(q('INSERT OR IGNORE INTO beam_reminder_messages (id, assignment_id, learner_id, body, proposal_id, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id('g1', 1), id('f0', 1), member('sam'), 'Hi Sam, you open with Tom on Tuesday. Please finish the opening steps and fridge log lessons before then.', id('g0', 3), ownerMember, at(-3.8)))
  await db.batch(statements)
}
