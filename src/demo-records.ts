// The demo's records: Sierra Lakes Produce, the employer the run site's homepage follows (src/site/landing/records.ts).
// 131 people across three sites (Fresno, CA 79; Joliet, IL 40; Chicago, IL 12), their owned procedures, courses, role
// paths and training history. src/demo.ts writes them; every date is days from the demo's start.

export const BUSINESS = 'Sierra Lakes Produce', ZONE = 'America/Los_Angeles', CENTRAL = 'America/Chicago', OWNER_NAME = 'Colleen Shaw'
export const DOMAIN = 'sierra-lakes.example', AGENT = 'sierra-ops'

export type Site = 'fresno' | 'joliet' | 'chicago'
export const SITES: Record<Site, { team: string; zone: string }> = {
  fresno: { team: 'Fresno, CA', zone: ZONE },
  joliet: { team: 'Joliet, IL', zone: CENTRAL },
  chicago: { team: 'Chicago, IL', zone: CENTRAL },
}

// The named staff: who leads, reviews, assesses and writes, and the people whose training the demo follows.
export const STAFF = {
  nadia: { name: 'Nadia Flores', site: 'fresno', roles: ['manager', 'assessor', 'reviewer', 'learner'] },
  ray: { name: 'Ray Ortiz', site: 'fresno', roles: ['manager', 'learner'] },
  maria: { name: 'Maria Chen', site: 'fresno', roles: ['assessor', 'learner'] },
  carmen: { name: 'Carmen Díaz', site: 'fresno', roles: ['reviewer', 'learner'] },
  keisha: { name: 'Keisha Grant', site: 'joliet', roles: ['manager', 'reviewer', 'learner'] },
  lena: { name: 'Lena Cho', site: 'chicago', roles: ['author', 'learner'] },
  pat: { name: 'Pat Nowak', site: 'chicago', roles: ['manager', 'learner'] },
  tomas: { name: 'Tomás Vega', site: 'fresno', roles: ['learner'] },
  ines: { name: 'Ines Varga', site: 'fresno', roles: ['learner'] },
  miguel: { name: 'Miguel Herrera', site: 'fresno', roles: ['learner'] },
  rafael: { name: 'Rafael Medina', site: 'fresno', roles: ['learner'] },
  juan: { name: 'Juan Morales', site: 'fresno', roles: ['learner'] },
  rosa: { name: 'Rosa Jimenez', site: 'fresno', roles: ['learner'] },
  tyrone: { name: 'Tyrone Booker', site: 'joliet', roles: ['learner'] },
  samp: { name: 'Sam Patel', site: 'joliet', roles: ['learner'] },
  hannah: { name: 'Hannah Brooks', site: 'chicago', roles: ['learner'] },
  derek: { name: 'Derek Lyle', site: 'joliet', roles: ['learner'], former: true },
} as const satisfies Record<string, { name: string; site: Site; roles: readonly string[]; former?: boolean }>
export type Named = keyof typeof STAFF
export type Person = Named | 'owner' | `crew${number}`

// The rest of the crew, enough for each site's headcount (the owner works from Fresno; Derek has left).
const FIRST = ['Adriana', 'Brandon', 'Cesar', 'Daniela', 'Elijah', 'Fatima', 'Gabriel', 'Hector', 'Isabel', 'Jamal', 'Kayla', 'Lorenzo', 'Marisol', 'Nathan', 'Olga', 'Pedro', 'Quinn', 'Rocio', 'Samuel', 'Tanya', 'Ulises', 'Valeria', 'Wesley', 'Ximena', 'Yolanda', 'Zachary', 'Andre', 'Bianca', 'Diego', 'Erica']
const LAST = ['Alvarez', 'Bennett', 'Castillo', 'Dawson', 'Espinoza', 'Fischer', 'Gutierrez', 'Hayes', 'Ibarra', 'Jensen', 'Kowalski', 'Lopez', 'Mendoza', 'Nguyen', 'Ortega', 'Pham', 'Quintero', 'Reyes', 'Sandoval', 'Thompson', 'Underwood', 'Villarreal', 'Washington', 'Yazzie', 'Zamora', 'Ramirez', 'Sullivan', 'Torres', 'Moreno', 'Carter']
const named = (site: Site) => Object.values(STAFF).filter(person => person.site === site && !('former' in person)).length
const HEADCOUNT: Record<Site, number> = { fresno: 79 - 1 - named('fresno'), joliet: 40 - named('joliet'), chicago: 12 - named('chicago') }
export const CREW: { key: `crew${number}`; name: string; site: Site }[] = (Object.keys(HEADCOUNT) as Site[]).flatMap(site => Array.from({ length: HEADCOUNT[site] }, () => site))
  .map((site, index) => ({ key: `crew${index + 1}` as const, name: `${FIRST[index % FIRST.length]} ${LAST[(index * 7 + Math.floor(index / FIRST.length)) % LAST.length]}`, site }))
export const crewAt = (site: Site) => CREW.filter(person => person.site === site).map(person => person.key)
export const siteOf = (person: Person): Site => person === 'owner' ? 'fresno' : person.startsWith('crew') ? CREW.find(item => item.key === person)!.site : STAFF[person as Named].site
export const nameOf = (person: Exclude<Person, 'owner'>) => person.startsWith('crew') ? CREW.find(item => item.key === person)!.name : STAFF[person as Named].name
export const emailOf = (person: Exclude<Person, 'owner'>) => `${nameOf(person).normalize('NFD').replace(/[^\w\s]/g, '').toLowerCase().replace(/\s+/g, '.')}@${DOMAIN}`

export const SOURCES = [
  { key: 'lift', title: 'Lift-truck operating procedure', licence: 'owned', evidence: 'Written by Ray Ortiz, Fresno warehouse manager, February 2026.', author: 'ray', versions: [
    { at: -240, file: 'lift-truck-procedure.txt', provenance: 'Operations share, Procedures/Lift trucks.docx exported as text', text: 'Lift-truck operating procedure\n\n1. Do the pre-shift inspection and sign the checklist before the first move.\n2. Forks low and tilted back when traveling; 5 mph inside, 3 mph at dock doors.\n3. Sound the horn at every blind corner and rack end.\n4. Never carry a load you cannot see over: travel in reverse.\n5. Park with forks down, controls neutral, brake set, key out.\n' }] },
  { key: 'ammonia', title: 'Ammonia emergency response plan', licence: 'owned', evidence: 'Sierra Lakes Produce plan, reviewed with the refrigeration contractor in January 2026.', author: 'nadia', versions: [
    { at: -300, file: 'ammonia-response-plan.txt', provenance: 'Safety binder, Fresno DC, section 4', text: 'Ammonia release\n\nAmmonia smells sharp and makes your eyes water at levels far below danger. If you smell it in a cooler or engine room: leave at once, upwind, and pull the nearest evacuation station. Do not go back for product or equipment. Call the shift supervisor from the muster point by the north gate.\n' }] },
  { key: 'cold', title: 'Cold room PPE standard', licence: 'owned', evidence: 'Fresno DC standard, approved by Colleen Shaw in March 2026.', author: 'nadia', versions: [
    { at: -150, file: 'cold-room-ppe.txt', provenance: 'Safety binder, Fresno DC, section 6', text: 'Cold room PPE\n\nCoolers run at 34°F. Insulated jacket, hood, gloves and lined boots before you enter; check each other at the anteroom door. Warm-up break every 90 minutes, or sooner if your hands go numb.\n' }] },
  { key: 'dock', title: 'Dock door procedure DP-7', licence: 'owned', evidence: 'Written by Keisha Grant, Joliet site lead.', author: 'keisha', versions: [
    { at: -200, file: 'dp-7-dock-doors.txt', provenance: 'Joliet DC procedures, DP-7 revision 5', text: 'DP-7 Dock doors\n\n1. Check the trailer restraint light is green before opening a door.\n2. Chock the wheels if the restraint will not engage.\n3. Open the door fully before the leveler goes down.\n' },
    { at: -4, file: 'dp-7-dock-doors.txt', provenance: 'Updated after near-misses at doors 7, 8 and 9', text: 'DP-7 Dock doors\n\n1. Check the trailer restraint light is green before opening a door.\n2. Walk to the trailer and look: a green light is not enough on doors 7, 8 and 9.\n3. Chock the wheels if the restraint will not engage.\n4. Open the door fully before the leveler goes down.\n5. Report every near-miss the same shift.\n' }] },
  { key: 'harassment', title: 'Harassment prevention policy', licence: 'owned', evidence: 'Sierra Lakes Produce policy, approved by Colleen Shaw in January 2026.', author: 'carmen', versions: [
    { at: -400, file: 'harassment-policy.txt', provenance: 'HR policies folder, policy 2.3 (PDF text)', text: 'Harassment prevention\n\nHarassment based on any protected characteristic is not tolerated. Report it to your supervisor, to Colleen Shaw or through the anonymous line. Nobody is punished for reporting in good faith.\n' }] },
  { key: 'security', title: 'Visitor and badge policy', licence: 'permission', evidence: 'Adapted with written permission from the building manager (email of Feb 3, 2026, filed in Admin/Permissions).', author: 'lena', versions: [
    { at: -120, file: 'visitor-badge-policy.txt', provenance: 'Chicago office, building handbook chapter 3', text: 'Visitors and badges\n\nEvery visitor signs in at reception and wears a visitor badge. Never hold the door for someone without a badge. Payment or bank-detail changes requested by email are confirmed by phone on a number we already have.\n' }] },
] as const
export type SourceKey = typeof SOURCES[number]['key']

export interface LessonData { title: string; body: string; sources?: SourceKey[] }
export interface QuestionData { prompt: string; choices: string[]; correct: number[] }
export interface CourseData {
  key: CourseKey; title: string; summary: string; author: Person; reviewer: Person; createdAt: number
  lessons: LessonData[]; questions?: QuestionData[]; passPercent?: number; maxAttempts?: number; practical?: string; assessor?: Person
  // Revisions, oldest first; the last published one is current.
  revisions: { state: 'superseded' | 'returned' | 'published' | 'in_review'; at: number; note?: string; lessons?: number }[]
}
export type CourseKey = 'lift' | 'ammonia' | 'cold' | 'harassment' | 'security' | 'dock' | 'receiving'

export const COURSES: CourseData[] = [
  { key: 'lift', title: 'Lift-truck safety', summary: 'The pre-shift inspection, load handling and pedestrians on our docks.', author: 'lena', reviewer: 'nadia', createdAt: -1200,
    lessons: [
      { title: 'Pre-shift inspection', body: 'Inspect the truck before the first move of every shift and sign the checklist.\n\n- Forks, chains and mast: no cracks, no bent tines.\n- Horn, lights and backup alarm work.\n- Brakes and steering respond before you load.', sources: ['lift'] },
      { title: 'Load handling', body: 'Forks low and tilted back when you travel. If the load blocks your view, travel in reverse.\n\n1. Square up to the pallet.\n2. Forks fully under, lift a few inches, tilt back.\n3. Check overhead before you raise into a rack.', sources: ['lift'] },
      { title: 'Pedestrians and dock edges', body: '5 mph inside, 3 mph at dock doors. Sound the horn at every blind corner and rack end, and stop when someone steps into your aisle.', sources: ['lift'] },
    ],
    questions: [
      { prompt: 'The load blocks your view. How do you travel?', choices: ['In reverse', 'Forward, slowly', 'With a spotter walking in front'], correct: [0] },
      { prompt: 'What is the speed limit at the dock doors?', choices: ['3 mph', '5 mph', '8 mph'], correct: [0] },
    ],
    passPercent: 100, maxAttempts: 2, practical: 'Do the pre-shift inspection, then move a pallet from dock 4 to rack row C, with your assessor watching.', assessor: 'maria',
    revisions: [{ state: 'superseded', at: -1100 }, { state: 'superseded', at: -700 }, { state: 'superseded', at: -420 }, { state: 'published', at: -230 }] },
  { key: 'ammonia', title: 'Ammonia release awareness (annual)', summary: 'Recognize a release in the cold rooms, leave upwind and call it in.', author: 'lena', reviewer: 'nadia', createdAt: -800,
    lessons: [
      { title: 'What a release smells like', body: 'Ammonia smells sharp and makes your eyes water long before it reaches a dangerous level. Treat the smell as the alarm.', sources: ['ammonia'] },
      { title: 'Leave upwind', body: 'Leave at once, upwind, and pull the nearest evacuation station on your way out. Never go back for product or equipment.', sources: ['ammonia'] },
      { title: 'Calling it in', body: 'Go to the muster point by the north gate and call the shift supervisor. Say where you smelled it and who else was nearby.', sources: ['ammonia'] },
    ],
    questions: [
      { prompt: 'You smell ammonia in cooler 2. What do you do first?', choices: ['Leave upwind and pull the evacuation station', 'Finish the pallet you are moving', 'Look for the leak'], correct: [0] },
      { prompt: 'Where is the muster point?', choices: ['By the north gate', 'In the break room', 'At dock 4'], correct: [0] },
    ],
    passPercent: 100, maxAttempts: 3,
    revisions: [{ state: 'superseded', at: -790 }, { state: 'published', at: -380 }] },
  { key: 'cold', title: 'Cold room safety & PPE', summary: 'Dressing for 34°F and knowing when to warm up.', author: 'lena', reviewer: 'nadia', createdAt: -160,
    lessons: [
      { title: 'Dressing for 34°F', body: 'Insulated jacket, hood, gloves and lined boots before you enter. Check each other at the anteroom door.', sources: ['cold'] },
      { title: 'Warm-up breaks', body: 'Take a warm-up break every 90 minutes, or sooner if your hands go numb. Tell your lead before you go.', sources: ['cold'] },
    ],
    questions: [{ prompt: 'How often is the warm-up break?', choices: ['Every 90 minutes, or sooner if your hands go numb', 'Once a shift', 'Only when your lead says so'], correct: [0] }],
    passPercent: 100, maxAttempts: 2, practical: 'Show a full PPE check at the cooler 2 anteroom, with your assessor watching.', assessor: 'owner',
    revisions: [{ state: 'published', at: -140 }] },
  { key: 'harassment', title: 'CA harassment prevention', summary: 'What harassment is, how to report it and why nobody is punished for reporting.', author: 'lena', reviewer: 'carmen', createdAt: -390,
    lessons: [
      { title: 'What harassment is', body: 'Harassment is unwelcome conduct based on a protected characteristic. It can be words, pictures, messages or touching.', sources: ['harassment'] },
      { title: 'Reporting, and no retaliation', body: 'Report to your supervisor, to Colleen Shaw or through the anonymous line. Nobody is punished for reporting in good faith.', sources: ['harassment'] },
    ],
    revisions: [{ state: 'published', at: -380 }] },
  { key: 'security', title: 'Security awareness', summary: 'Badges, visitors and payment requests that arrive by email.', author: 'lena', reviewer: 'nadia', createdAt: -110,
    lessons: [
      { title: 'Badges and visitors', body: 'Every visitor signs in at reception. Never hold the door for someone without a badge.', sources: ['security'] },
      { title: 'Payment requests by email', body: 'A request to change payment or bank details is confirmed by phone, on a number we already have, before anything changes.', sources: ['security'] },
    ],
    questions: [
      { prompt: 'Someone without a badge follows you to the door. What do you do?', choices: ['Send them to reception', 'Hold the door', 'Ask who they are visiting and let them in'], correct: [0] },
      { prompt: 'A supplier emails new bank details. What happens next?', choices: ['Confirm by phone on a number we already have', 'Update them right away', 'Reply to the email to check'], correct: [0] },
    ],
    passPercent: 100, maxAttempts: 3,
    revisions: [{ state: 'published', at: -100 }] },
  { key: 'dock', title: 'Dock door safety (DP-7)', summary: 'Trailer restraints, chocks and levelers at the Joliet doors.', author: 'lena', reviewer: 'keisha', createdAt: -210,
    lessons: [
      { title: 'Before you open a door', body: 'Check the trailer restraint light is green before you open a door.', sources: ['dock'] },
      { title: 'Chocks and levelers', body: 'Chock the wheels if the restraint will not engage. Open the door fully before the leveler goes down.', sources: ['dock'] },
      { title: 'Near-miss reporting', body: 'Report every near-miss the same shift, even when nobody was hurt.' },
    ],
    questions: [
      { prompt: 'The restraint light is red. What do you do?', choices: ['Chock the wheels before opening', 'Open the door slowly', 'Ask the driver to back up'], correct: [0] },
      { prompt: 'When do you report a near-miss?', choices: ['The same shift', 'At the monthly safety meeting', 'Only if someone was hurt'], correct: [0] },
    ],
    passPercent: 100, maxAttempts: 2,
    revisions: [{ state: 'published', at: -195 }, { state: 'in_review', at: -1 }] },
  { key: 'receiving', title: 'Receiving and FIFO rotation', summary: 'Checking in a load and rotating stock first in, first out.', author: 'lena', reviewer: 'nadia', createdAt: -6,
    lessons: [{ title: 'Checking in a load', body: 'Count against the bill of lading, check the pulp temperature, and date every pallet before it goes to a cooler.' }],
    revisions: [] },
]

export const PATHS = {
  fresno: { name: 'Fresno warehouse essentials', site: 'fresno', at: -500, requirements: [{ course: 'ammonia', dueDays: 14, renewalDays: 365 }, { course: 'cold', dueDays: 14 }, { course: 'lift', prerequisite: 'ammonia', dueDays: 21, renewalDays: 1095 }] },
  joliet: { name: 'Joliet dock essentials', site: 'joliet', at: -480, requirements: [{ course: 'dock', dueDays: 7, renewalDays: 365 }, { course: 'lift', dueDays: 21, renewalDays: 1095 }] },
  chicago: { name: 'Chicago office essentials', site: 'chicago', at: -120, requirements: [{ course: 'security', dueDays: 14, renewalDays: 365 }] },
} as const satisfies Record<Site, { name: string; site: Site; at: number; requirements: readonly { course: CourseKey; prerequisite?: CourseKey; dueDays: number; renewalDays?: number }[] }>

// Attested classroom sessions; most of the crew's history before Beam was recorded from these.
export const SESSIONS = {
  1: { course: 'ammonia', held: -200, instructor: 'Valley Refrigeration Safety, contract trainer', location: 'Fresno DC, cold dock', attestation: 'Annual ammonia drill: every attendee walked the upwind route to the north gate and named the evacuation stations.' },
  2: { course: 'ammonia', held: -346, instructor: 'Valley Refrigeration Safety, contract trainer', location: 'Fresno DC, cold dock', attestation: 'Annual ammonia drill, night shift session.' },
  3: { course: 'cold', held: -120, instructor: 'Nadia Flores, operations supervisor', location: 'Fresno DC, cooler 2 anteroom', attestation: 'PPE check demonstrated by each attendee at the anteroom door.' },
  4: { course: 'lift', held: -400, instructor: 'Maria Chen, lift-truck evaluator', location: 'Fresno DC, dock 4 and rack row C', attestation: 'Operator evaluation: inspection and observed pallet moves, 8 of 8 checks for each attendee.' },
  5: { course: 'lift', held: -380, instructor: 'Keisha Grant, site lead', location: 'Joliet DC, doors 1 to 12', attestation: 'Operator evaluation: inspection and observed pallet moves for each attendee.' },
  6: { course: 'lift', held: -1076, instructor: 'Maria Chen, lift-truck evaluator', location: 'Fresno DC, dock 4 and rack row C', attestation: 'Operator evaluation, three-year renewal cycle.' },
  7: { course: 'harassment', held: -150, instructor: 'Carmen Díaz, HR', location: 'Fresno DC, break room', attestation: 'Two-hour session in English and Spanish; attendees completed the case exercises.' },
  8: { course: 'security', held: -90, instructor: 'Lena Cho, training coordinator', location: 'Chicago office, conference room', attestation: 'Security awareness briefing with the phishing exercise.' },
  9: { course: 'dock', held: -60, instructor: 'Keisha Grant, site lead', location: 'Joliet DC, door 8', attestation: 'Walked doors 1 to 12 with each attendee: restraint light, chocks and leveler order.' },
} as const satisfies Record<number, { course: CourseKey; held: number; instructor: string; location: string; attestation: string }>
export type SessionKey = keyof typeof SESSIONS
