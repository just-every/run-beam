# Beam contract

Beam is a Learning edition for one business that teaches its own procedures to
its own adult staff. A reviewer publishes an owned procedure as training, staff
complete the correct revision, and the manager can recover assignment, attempt
and completion evidence. Each clause says what a person can do and is proven
through public doors: the JSON door `/api/beam/*`, the HTML form door
`/app/do/*`, the pages under `/app`, access-checked downloads, and `rer`.
`tests/beam/flows.mjs` (with `tests/beam/agent-flows.mjs`) runs the built
Worker with real local D1 and R2, one check per clause; `tests/beam/journey.mjs`
drives a real browser at 1440 and 390 pixels from a fresh clone. Every person
in fixtures and tests is invented.

Progress, completion and competence are kept apart: reading lessons is
progress; a completion records what happened (method and evidence) against an
exact revision; practice is neither; Beam never records that someone is
competent. Roles are checked inside every action and view, not only by the
page that links to it.

## First release

The first release's thirteen flows map to clauses: 1 → BEAM-01, 2 → 02, 3 → 03,
4 → 04, 5 → 05, 6 → 06, 7 → 07, 8 → 08, 9 → 09, 10 → 10, 11 → 11, 12 → 12,
13 → BEAM-15 (import preview), BEAM-17 (progress report) and BEAM-16
(export and restore).

| Clause | Observable guarantee | Proof |
| --- | --- | --- |
| BEAM-01 | One business with a name and IANA time zone, configured by the owner before anything else. Adult staff are invited by the owner through ordinary emailed sign-in, hold author, reviewer, learner, manager and assessor roles, and belong to teams. Removing access ends every session; restoring it needs a fresh sign-in. Roles are enforced on every action and read. | `flows.mjs` |
| BEAM-02 | Owned source documents and media are uploaded with licence basis and evidence, provenance and a responsible reviewer. Bytes are checksummed, verified after storage and on every read; versions are immutable. Learners open only material cited by training assigned to them. Uploaded content is inert: never rendered as HTML or script. | `flows.mjs`, `journey.mjs` |
| BEAM-03 | Courses have one editable draft with version-checked saves (a stale save is refused, never merged). Submitting freezes an immutable revision; only the course's named reviewer (or the human owner) publishes or returns it. Publication uses the private human session and publication form; JSON publication is refused regardless of cookie or body encoding. Publishing supersedes the previous revision; later draft edits never change a published revision. | `flows.mjs`, `regressions.mjs`, `journey.mjs` |
| BEAM-04 | Role paths list a team's required courses with due days, prerequisites and renewal intervals. Saving a path creates a new path revision; assignments keep the revision they came from. A learner cannot start a course until its prerequisite is completed. Assigning a path twice creates no duplicates. | `flows.mjs` |
| BEAM-05 | Assignments go to individuals and teams with a due date, time and explicit IANA time zone, and bind the course's published revision. One open assignment per learner and course. Invalid dates and zones are refused. | `flows.mjs`, `journey.mjs` |
| BEAM-06 | Lesson progress is stored on the server; a learner resumes at the next unread lesson from any device or session, at desktop and phone widths. | `flows.mjs`, `journey.mjs` |
| BEAM-07 | Deterministic quizzes: a question scores only when exactly the correct choices are selected; the pass mark is a percentage. Every attempt keeps its responses, score, scoring rule and retry decision. When attempts run out a manager may grant one more, with a reason. | `flows.mjs`, `journey.mjs` |
| BEAM-08 | Practical evidence (text and an optional file) goes to the assessment's named assessor; only that person with the current assessor role can read and accept or reject it (the learner and managers retain read access), and nothing completes before the decision. Removing the role immediately removes decision, queue and evidence access from existing sessions. | `flows.mjs`, `regressions.mjs` |
| BEAM-09 | Native learning completion is recorded only when every lesson of the assigned revision is done and each required assessment is passed or accepted, and binds the exact course and assessment revision with its evidence. Offline completion uses the separate instructor attestation in BEAM-10. Every completion linked to an assignment must match its learner, course and exact course revision. No door turns partial progress into a completion. Publishing a new revision, with or without reassignment, leaves earlier completions bound to their revision. | `flows.mjs`, `journey.mjs` |
| BEAM-10 | Managers and assessors record instructor-attested offline training (date, instructor, location, attestation, optional evidence file) against an explicitly selected current or historical published revision; it closes only assignments for the same learner, course and exact revision and records its provenance. Another revision's open assignment stays open; that attendance has its own completion and certificate. Future dates are refused. | `flows.mjs`, `regressions.mjs` |
| BEAM-11 | Every completion issues a numbered certificate naming the issuer (the business), learner, course revision, date and optional expiry, stating that it is not an accreditation or a statement of competence. Learners see their own; managers see all. | `flows.mjs`, `journey.mjs` |
| BEAM-12 | In-app reminders for assignments due within three days or overdue; manager queues for overdue work, exhausted quiz attempts and renewals due within 30 days (assignable in one action); reviewer queues for revisions and source-change notices; assessor queues for practical evidence. Repeated renewals retain the completed assignment's interval, path revision and prerequisite even after the path changes; each certificate keeps that expiry policy. One latest completion per learner/course is considered, including when offline dates tie, and no renewal duplicates an open assignment. | `flows.mjs`, `regressions.mjs` |
| BEAM-13 | A learner cannot read another person's assignments, attempts, evidence files, records or certificates (answered as not found). Signed-out requests get nothing private. Cross-origin posts are refused. | `flows.mjs` |
| BEAM-14 | Procedure maintenance without a model account: a new source version flags every course whose published lessons cite an earlier version for its reviewer, who records whether the change is material. The owner's agent uses a preparation-only credential delegated from a live ordinary human session of an author, reviewer or manager: current access and roles, session revocation and expiry apply on every request, and it cannot publish, decide, administer or use human forms. A proposed draft (from a person, or the owner's own agent through the API) records the draft version and source versions it was prepared from, the source passages it relies on (each quoting one of those inputs) and the information it found missing; the reviewer sees both. It applies only to that unchanged draft and never to a published revision. | `flows.mjs` BEAM-14 and BEAM-18, `regressions.mjs` |
| BEAM-15 | TalentLMS move-in kit (records first): course list CSV and course report workbooks (users overview and timeline). The preview writes nothing and reports matched and unresolved people, duplicates, unreadable rows, unmapped courses and gaps (certificate files, course content). Apply is bound to the reviewed fingerprint through Base's D1 import kit with a durable journal and retained originals. Imported completions stay labelled TalentLMS history and complete nothing current. Re-importing the same export adds nothing. Undo removes untouched imported rows and keeps rows a manager reviewed after import. | `flows.mjs` |
| BEAM-16 | `rer export` writes every Beam table and stored file to an owner-only archive without sessions or credentials; import restores it into an empty fresh clone, refusing corrupt or non-empty targets; a second export is identical; records, files and certificates read back after a new sign-in. Export refuses to write into `public/`, and a build refuses to ship an archive copied there. | `journey.mjs` (`restore.mjs`) |

## Agent-prepared work

Five agent workflows run through the owner's own agent with a
preparation credential; Beam calls no model. Source to reviewed course and
maintaining changing procedures are BEAM-14; targeted paths and follow-up are
BEAM-18; diagnose before assigning is BEAM-19; practise a scenario is BEAM-20.
Proposals are listed at `/app/agent` and `GET /api/beam/proposals`, prepared
with `POST /api/beam/agent.propose` and decided with `agent.decide` by a human.

| Clause | Observable guarantee | Proof |
| --- | --- | --- |
| BEAM-17 | A manager reads a training report of every assignment and every completion recorded without one (offline attendance): learner, course and exact revision, status (open, overdue, completed, expiring within 30 days), due time in its zone, lessons done, quiz attempts and result, practical decision and assessor, completion, certificate and expiry. Course, team and status filters narrow it; the CSV download carries the same rows and keeps spreadsheet formulas inert. Learners are refused. | `flows.mjs` BEAM-17, `journey.mjs` |
| BEAM-18 | The owner's agent prepares targeted assignment plans and reminder drafts for a manager's approval. Every proposal records the agent, the person whose credential it used, its inputs (source versions, course or path revisions, assignments, question plans), reasons, exclusions with reasons and its exact payload with that payload's SHA-256. Nothing reaches staff or assignments before a human approves; the agent cannot decide, people without the kind's authority cannot decide, and an approval names the payload it reviewed. Approval records who, when, the note and the result. An assignment plan binds the course revision it names and is refused, staying undecided, once a newer revision is published; approved reminders appear in-app to the learner of a still-open assignment only. | `flows.mjs` BEAM-18, `journey.mjs` |
| BEAM-19 | Diagnose before assigning: the owner's agent prepares a question plan (purpose, questions, participants, closing date) and a manager approves it before anyone is asked. Answering is optional and once only; an invitee may decline. Answers are stored without the person or time; managers and their agent see participation counts, and the answers only after the plan closes with at least three answers, in no particular order. A process-change recommendation drawn from it is recorded when the manager approves it; Beam never turns answers into ratings. | `flows.mjs` BEAM-19, `journey.mjs` |
| BEAM-20 | The owner's agent prepares a text practice scenario for a published revision: situations, choices, feedback and a rubric, citing only sources the revision's lessons cite; a scenario with a dangling or unreachable step, or no ending, is refused. Only the course's named reviewer (or the owner) deploys it. A learner assigned that revision practises it from the course page, sees feedback after each choice and can start again; practice is never scored, never creates attempts, completions or certificates, and nobody else can open their runs. | `flows.mjs` BEAM-20, `journey.mjs` |

## Decided defaults

Recorded as decided for this release:

- Scope: one employer's adult staff and owned, non-regulated procedures.
  Customer academies come later with their own identity and consent rules.
- Jurisdiction: an Australian pilot. Beam records completion evidence, not
  accreditation, payroll or statutory certification; reminders state that
  training is done in paid working time.
- Start order: source and reviewer, learner and assessment, revision-bound
  evidence, record imports, then agent maintenance.
- First move-in kit: TalentLMS records first (course list CSV and course
  report workbooks); course content is rebuilt as native lessons, never
  reconstructed from a progress spreadsheet.
- No provider account: local sign-in through the development outbox, local
  uploads, in-app reminders and downloads. Agents work through the
  preparation credential; Beam itself calls no model.
- Question plans release answers only after closing with at least three
  answers (`MIN_ANSWERS` in `src/beam/questions.ts`).
- Name: Beam is kept as the working name; the Australian "BEAM Learning
  Management System" collision stays a recorded launch-naming risk.

Disclosed limits: source files up to 25 MB, evidence files up to 8 MB, kit files
up to 10 MB each with up to five course reports per import. These are local
admission limits, not hosted capacity claims.

## Not in the first release

SCORM or xAPI playback, live classrooms, course sales, HR or payroll links,
licensed libraries, proctoring, child learners, accreditation, customer
academies, outbound reminder mail, voice or avatar practice, model calls from
Beam itself (phase two adds the owner's model account), and the Trainual,
360Learning, Moodle and authoring-tool move-in kits.
