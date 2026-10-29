# Run it locally

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Enter the real owner mailbox through the setup prompt or `--owner-email` (or a
private answers file inside the checkout: `--answers exports/answers.json
--non-interactive`). `dev` prints `RER_OPEN`, which opens Beam signed in as the
owner; `dev --as learner|author|reviewer|manager` prints one for a persona
(real local members at `<as>@dev.localhost`, defined in `src/dev-personas.ts`).
No external mail is sent (invitations and sign-in links answer as sent) and no
provider account is needed. Stop servers with
`rer dev --stop` or `rer preview --stop`
before build or verification.

```sh
rer verify
rer reset --yes
rer export --output exports/installation.rer
rer import --input exports/installation.rer --yes
rer deploy --dry-run
rer describe
```

`verify` builds, typechecks and runs `tests/email-link.mjs` and
`tests/beam/flows.mjs` (with `agent-flows.mjs`) plus the focused
`tests/beam/regressions.mjs` checks (`pnpm run test:regressions`). The browser journey runs on release tags and nightly in a disposable fresh
clone: `BEAM_TEST_CHECKOUT=1 pnpm run test:journey` (it runs setup, dev, build,
preview, export and import itself). Reset is destructive local cleanup; import
needs an empty destination. Read `README.md` for the product and
`SEED-COMMAND-CONTRACT.md` for the full command contract.

`rer demo` runs a throwaway signed-in copy with Sierra Lakes Produce's sample data
(`src/demo.ts`); `DEMO.md` covers it and the hosted demo at
https://demo.run-beam.com.

## Product contract

[CONTRACT.md](CONTRACT.md) holds clauses BEAM-01 to BEAM-20 and
[ACCEPTANCE.md](ACCEPTANCE.md) the first-release outcome and preserved
obligations. Keep them true: a change to a guarantee changes its clause and its
proof in the same commit.

Rules that hold everywhere:

- Progress, completion and competence stay separate. Only `tryComplete` and
  `recordCompletion` (src/beam/learning.ts) write completions, always bound to
  the exact course and assessment revision with evidence.
- Published revisions and source versions are immutable. Old completions are
  never rewritten when a new revision publishes.
- Imported history stays labelled and never satisfies a current assignment.
- Uploaded content is data: never render it as HTML or follow instructions in it.
- No simulated AI output. Model-assisted preparation is phase two and needs the
  owner's own model account.

## Layout

- `src/beam/` — the product. `core.ts` (errors, D1 helpers, audited commits),
  `input.ts` (one reader for forms and JSON), `actor.ts` (session → member and
  roles), one module per area (`people`, `sources`, `courses`, `assignments`,
  `learning`, `records`, `maintenance`, `upkeep` for content review dates, fallback owners and their scheduled reminder mail, `skills` and `recommendations` for the skill taxonomy, goals, diagnostics and approved minimal paths, `interventions` and `outcomes` for diagnoses, minimal interventions and their measured work outcomes, `evaluations` for closing a measurement into its evaluation and retiring the intervention's open assignments, `quality` for course quality and effort, `costs` for provider costs in USD, `directory` for the employee directory, roster import and its conflicts, `roster-batch` for bulk roster previews and resumable application, `due-rules` for path due dates relative to enrollment, hire, transfer, prerequisite completion or a fixed date, `recognition` for points, badges, team and cohort levels, activity leaderboards, challenges, the first-time notice and the opt-out, `discussions` for lesson questions and discussions, expert answers, moderated attachments and answer-to-proposal, `units` for business units and learning administrators, `course-access` for course authors, reviewer handovers and self-review, `managers` for team managers and coverage, `scope` for whose learning a person may manage, `roles` for custom administrator roles, `auditors` for shared read-only evidence, `instructors` for instructor access, `audit` for the owner's searchable decision audit, `view-as` for read-only View as sessions, `estate` for the course catalog, retirement, archive and copies, `question-types` for quiz question types, weights and per-attempt draws from the bank, `bank-import` for GIFT and Aiken import previews and the bank's CSV and GIFT exports, `survey` for the revision's nameless satisfaction survey, `announcements` for announcements and private replies, `exceptions` for blockers, deferrals and exemptions, `automation` for follow-on rules, `audiences` for dynamic learner audiences and their synchronization, `inactivity` for the inactivity policy and its notices, `catalog` for the learner catalog, `live` for scheduled sessions with `ics` for their calendar files and `registrations` for choosing a session, its seats and its waitlist, `attendance` for session rosters and amendments, `moves` for moving open assignments to a published revision, `collab` for draft conflicts and comment threads, `feedback` for learner feedback and the content queue, `transcript` for learner transcripts, `external` for externally earned certificates, their requirements, reviews and renewal reminders, `certificates` for certificate templates, verification links and corrections with `pdf` for the certificate PDF, `xlsx` for workbook downloads), `actions.ts` (every write by name),
  `views.ts` (every read), `http.ts` (the doors), `ui/` (server-rendered pages,
  client scripts for the quiz, progressive ordering/matching and bounded import uploads), `movein/` (TalentLMS kit on Base's import kit).
- `migrations/core/` — numbered D1 migrations: 0001–0005 Base auth, outbox,
  portability and first-run; 0006 Beam; 0007 the import kit schema; 0008–0014
  Base provider control, dependency approval and owner claim; 0015 the import
  kit upgrade to Base `79f61fa`; 0016 Beam agent work; 0017 Base's owner
  sign-in link (`rer signin`); 0018 the import kit's resumable erasure; 0019 Beam's assignment resets (LEARN-019); 0020 policy acknowledgments (LEARN-010); 0021 course access windows (AUTO-009); 0022 timed assessments (LEARN-018); 0023 business units and administrator grants (ORG-002); 0024 course-scoped authors, reviewer handovers and self-review (ORG-003); 0025 team managers, coverage and due-date exceptions (ORG-004); 0026 custom administrator roles (ORG-010); 0027 read-only auditor grants (ORG-005); 0028 the audit's route column (OPS-001); 0029 read-only view-as sessions (ORG-012); 0030 course retirement and copies and 0031 course catalog details (AUTHOR-005); 0032 announcements and private replies (NOTICE-006); 0033 blockers, deferrals, exemptions and the exception policy (AUTO-006); 0034 follow-on rules and their runs (AUTO-005); 0035 the inactivity policy and its notices (AUTO-007); 0036 the learner catalog's enrollment settings, requests, favorites and saved searches (ORG-007); 0037 live sessions, their meetings, registrations and changes (LIVE-001); 0038 session seats, registration deadlines, waitlists and roster events (LIVE-002); 0039 the revision's attendance rule and attendance records with amendments (LIVE-003); 0040 assignment moves to a new revision and move entries in the reset history (AUTHOR-010); 0041 draft conflicts, comment threads and learner feedback (AUTHOR-003); 0042 instructor grants (ORG-005); 0043 external certificate requirements and certificates (LIB-006); 0044 certificate templates, corrections and verification links (LEARN-002); 0045 question-bank draws, weights, written-answer grading, feedback timing and the satisfaction survey (LEARN-001); 0046 the employee directory: members rebuilt with an optional work email and linked to their sign-in account by id, directory and custom fields, roster conflicts, and location scope on custom roles (ORG-001); 0047 dynamic audiences, their members with reasons, exclusions, requirement audiences and the transfer date (AUTO-001); 0048 roster batches with their rows and outcomes, and usernames (ORG-006); 0049 path due anchors and fixed dates, the assignment's due rule and the person's time zone (AUTO-003); 0050 lesson discussion threads, posts and their reviewed attachments (LEARN-014); 0051 recognition settings, badges, team and cohort levels and leaderboards, challenges and each person's recognition choice (LEARN-013). Import-kit migrations come from
  `node --experimental-strip-types scripts/beam/import-kit-migration.mjs OUT BASE_SHA`,
  which writes only what the applied ones lack. Never edit an applied
  migration; add the next number.
- `src/modules/` — Base operator-auth, mail, dependencies, owner-claim, demo,
  import-kit and d1-transport; `src/base/` and `scripts/edition-authoring/` — the Base runtime
  pieces (Lobby, setup state, static assets, hydration) and authoring tool.
  They are byte copies of Base recorded in `base-copies.json`, all at the
  commit of the pinned rer release (applied migrations stay out of refreshable source copies:
  an applied migration is never rewritten by a refresh); check with
  `node scripts/edition-authoring/cli.mjs verify-base` and move to a newer Base
  with `refresh-base`. The `rer` command itself is the pinned
  `@runeditrun/rer` package. `edition.json` and `sources.lock.json` declare the
  components; re-run `node scripts/edition-authoring/cli.mjs lock` after
  intentional edits (`verify` checks the lock and the copy record first and
  fails until then). `src/base/font-head.ts` is Beam's own adaptation (it
  preloads Inter, the body face) and is deliberately not in the copy record.
- `src/site/` — the static run site (`rer build --site`): the desk-approved landing (`landing/`, one month at
  Sierra Lakes Produce; its figures in `landing/records.ts`), Base's Run page and the docs rendered from
  `docs/*.md` (`docs/`), on the site's own tokens (`public/site/theme.css`) and faces (`public/site/fonts.css`).
  The painted bands are `public/site/*.avif|webp`; the vest mark and favicons are in `public/brand/`.
- `tests/beam/` — `flows.mjs` (one check per clause against the built Worker),
  `journey.mjs` and `restore.mjs` (browser and recovery from a fresh clone),
  `fixtures.mjs` (documented-shape TalentLMS fixtures).

## Agent acceptance view

CONTRACT.md remains authoritative for agent statuses, evidence and gaps.
Regenerate the final agent adoption section of the legacy ACCEPTANCE.md after
changing BASE-AGENT or SURFACE rows; the generator preserves all earlier prose
and never changes a judgment. Pass touched ids as a comma-separated
`--clauses ID,ID` argument. Check with
`node scripts/beam/agent-contract-docs.mjs check`.

Lander-Regenerate: node scripts/beam/agent-contract-docs.mjs write

## Agents operating Beam

The canonical MCP door is `/mcp`; `/api/beam/mcp` is an alias of the same
shared door. It supports MCP 2026-07-28 and 2025-11-25. The owner must explicitly
choose the company policy on `/agents` before agent work runs: there is no
preset disposition. An unanswered policy returns `policy_unset` with a setup
link and changes no learning state. Review, exact approval, blocked calls,
invocation audit and person-only Pause/resume use that shared policy path.
Preparation REST reads and writes also enter the same shared invocation path;
using `/api/beam/` does not bypass policy, Pause, audit or idempotency checks.
Every preparation write needs an `idempotency_key`; include it alongside the
payloads below and reuse it only for the identical work. Draft edits retain
their native `draftVersion` checks.

This is a bounded CORE adoption for existing preparation actions/reads and
the three existing application MCP jobs. Resources, prompts, events and
subscriptions are undeclared and return typed capability refusals. Publication,
assessment and proposal decisions, enrollment, workforce administration,
automation and provider tools remain outside the registry. Full Core coverage,
the specialist week and provider budgets remain contract gaps. The exact
tool names, possible classes and clause mappings are in
[docs/agent-work.md](docs/agent-work.md); each tool's scope equals its name.

Agents use a scoped preparation credential, never a human session cookie. A
human signed in by ordinary email link or OIDC issues it with
`POST /api/beam/agent.issue` and `{ "expiresInSeconds": 3600 }`. The response
contains `token` and `expiresAt`; keep it private and send it as
`Authorization: Bearer <token>`. Keep the human browser session private and
separate. Dev-identity and review sessions cannot issue these credentials, so
issue one from a hosted installation's ordinary sign-in. Authors, reviewers and
managers can issue one; it carries that person's current roles.

The credential expires within one hour and no later than its parent session.
Signing out or revoking that session, or removing the person's access, revokes
its credentials too; restoring access does not revive them. Current roles are
checked on every request. Credentials can read `me`, `members`, `sources`,
`courses`, `courses/:id`, `revisions/:id`, source bytes at
`source-files/:versionId`, and (with the manager role) `people`, `paths`,
`report`, `proposals`, `proposals/:id` and `questions/:id`, subject to each
native reader's authority. They can also read permitted `impact/:id` and
`diagnosis-imports/:id`. They can create courses, edit draft details, lessons,
blocks, questions, assessment rules and surveys, submit drafts for review,
create course-draft and source-impact proposals, and prepare `agent.propose`,
`diagnosis.prepare` and `outcome.plan` work.
They cannot decide proposals, publish, assign, record completions, administer
people, issue more credentials, or use any form/auth route.

Humans retain the broader JSON reads and actions below. Publication is the
exception: only the human publication form `/app/do/revision.decide` publishes,
under the existing reviewer authorization. JSON publication is always refused,
even with a human cookie. Reads are `GET /api/beam/me`, `/api/beam/people`,
`/api/beam/members`, `/api/beam/directory` (custom fields and held roster conflicts), `/api/beam/directory/:id` (one person's directory record as you may see it), `/api/beam/audiences` (the audiences you manage with members, past members and exclusions), `/api/beam/roster-batches` (your latest roster batches with each row's planned action and outcome), `/api/beam/sources`, `/api/beam/courses`,
`/api/beam/courses/:id`, `/api/beam/revisions/:id`, `/api/beam/paths` (with each requirement's due anchor; `POST /api/beam/path.preview` with `{ path }` returns every member's due dates without assigning),
`/api/beam/assignments/:id`, `/api/beam/attempts/:id`, `/api/beam/records/:id`
(or `/api/beam/records/me`), `/api/beam/queues`, `/api/beam/reminders`, `/api/beam/quality?course=&team=` (REPORT-005 course quality and effort per revision, never per person), `/api/beam/coverage?team=&role=&location=&course=&status=&effective=&requirement=` (REPORT-001 requirement coverage over the active roster, with MOVE-009 credits; `credit.preview`, `credit.approve` and `credit.undo` take `{ course, intervalDays, reason }` or `{ credit, reason }` from the owner or the course unit's learning administrator), `/api/beam/costs` (the owner's provider costs in USD), `/api/beam/skills` (the LEARN-007 skill taxonomy and its course and role mappings), `/api/beam/skills/:id` (or `skills/me`: a person's needed skills, inputs and suggested minimal path with its `digest`),
`/api/beam/certificates/:id` (with its template, corrections and links; the PDF at `/app/certificates/:id.pdf`), `/api/beam/certificate-templates`, `/api/beam/imports`, `/api/beam/history`,
`/api/beam/compare?from=REV&to=REV` (two revisions of one course),
`/api/beam/source-compare?from=VER&to=VER` (two versions of one source),
`/api/beam/acknowledgments`, `/api/beam/acknowledgments/:id` `/api/beam/units` (the owner's units and administrator grants, or a learning administrator's own) `/api/beam/roles` (custom roles with their holders, or the roles you hold), `/api/beam/auditors` (the owner's auditor grants), `/api/beam/evidence` (an auditor's shared evidence), `/api/beam/recognition` (your points, badges, levels and recognition choice, the leaderboards and challenges of your teams and cohorts, and what you may configure), `/api/beam/discussions/:courseId` (a course's lesson questions and discussions for its cohort, experts and moderators; files at `/app/files/discussion/:id`), `/api/beam/discussion-notices` (answers waiting for you and questions waiting for you as an expert), `/api/beam/external` (external certificate requirements, your own standing and reminders, certificates waiting for your review, and renewals due for your people) and `/api/beam/audit?q=&category=&actor=&from=&to=` (the audit search: everything for the owner, their slice for a learning administrator or auditor; CSV at `/app/audit.csv`). Writes are `POST /api/beam/ACTION` with a JSON body and
an `Origin` header equal to the app origin; the human action names are the keys of
`src/beam/actions.ts`, subject to publication restrictions above. A timed quiz is `quiz.start`, then `quiz.save` and `quiz.submit` before the deadline it returns. Files go as `{ "filename": "...", "base64": "..." }`.

To propose course changes from source material, read `/api/beam/courses/:id` (its
`draftVersion` and `draft`) and the cited source versions, then
`POST /api/beam/proposal.create` with `{ course, draftVersion, summary, agent,
inputs: [sourceVersionIds], draft }`. A reviewer or author accepts it; it is
refused if the draft changed meanwhile, and it never publishes anything. Add
`passages: [{ sourceVersion, quote, lesson }]` (each from one of `inputs`) and
`missing: ["..."]` so the reviewer sees what the draft relies on and lacks.

When a source changes (AGENT-004), read `/api/beam/impact/:noticeId` (notice ids are in `courses/:id` `notices`): the changed
passages, `lessons.affected`/`untouched`, `questions.affected` (with `part`: `answer` or `prompt`)/`untouched`, `practical`,
`scenarios`, and affected `roles` as counts with renewal dates. `POST /api/beam/impact.propose` with `{ notice, draftVersion }`
creates Beam's own rule-based proposal (exact quotes of a changed line rewritten and re-cited; the rest under `missing`).
Only the named reviewer or the owner decides the notice: `notice.decide` with `decision`, `note`, `nextReviewOn` and, for
`draft_updated`, `retraining: 'none'` or `'required'` with `retrainRoles` (affected roles) and `retrainDueOn`.

Other prepared work goes to `POST /api/beam/agent.propose` with `{ kind, title,
agent, inputs: [{ type, id }], reasons: ["..."], excluded: [{ item, reason }],
payload }`. Input types are `source_version`, `course_revision`,
`path_revision`, `assignment`, `question_plan` and `diagnosis` (a reviewed AGENT-003 diagnosis; list them at `/api/beam/diagnoses`). Kinds and payloads:

- `assignment_plan` (manager): `{ items: [{ learner, course, courseRevision,
  dueDate, dueTime, timezone }] }`, naming each course's current published
  revision.
- `reminders` (manager): `{ items: [{ assignment, message }] }` for open
  assignments. Training is paid work time; never imply otherwise.
- `question_plan` (manager): `{ title, purpose, questions, participants,
  closesOn }`. Read the answers later at `questions/:planId`: they come back
  without names, only after closing with at least three answers. Never rank or
  judge people from them.
- `process_change` (manager): `{ summary, change, questionPlan? }`.
- `intervention` (manager): `{ diagnosis, recommended, options: [{ id, kind, summary, expectedBenefit, people, paidMinutesPerPerson, course?, courseRevision?, dueDate?, dueTime?, timezone? }] }` from a reviewed diagnosis, with kinds `clarification`, `practice`, `assessor_session`, `cohort_assignment`, `process_change` and one `broad_course` covering everyone in the diagnosed role for comparison; never recommend the broad course. The manager decides with `option` and `people`.
- Measuring an intervention (AGENT-005): while it waits, prepare its plan with `outcome.plan` `{ intervention, metric, unit, direction: 'lower'|'higher', baselineFrom, baselineTo, afterFrom, afterTo, comparison: 'rest_of_role'|'none', minGroup }` (dates YYYY-MM-DD in the business zone, inclusive). Only a person approves it (`outcome.approve`) and imports outcomes (`outcome.import`); read the group comparison at `/api/beam/outcomes/{plan}`, which never names or ranks anyone.
- Evaluating and retiring (AGENT-008): after the after period, the owner or the approving manager closes it with `outcome.close` `{ plan }`; Beam's rule-made evaluation (finding, observed interval, changed conditions, alternatives, and the open assignments you may retire) is at `/api/beam/evaluations/{plan}`. Only a person retires: `outcome.retire` `{ plan, assignments, note? }`. Preparation credentials can do neither.
- `scenario` (author): `{ course, courseRevision, title, rubric, steps: [{ id,
  situation, choices: [{ label, feedback, next, sources }] }] }`, citing only
  sources the revision's lessons cite. The course's named reviewer deploys it.

A human decides at `/app/agent` (or `agent.decide` with the payload's
`sha256`); the decision and its result are recorded on the proposal.

## Application API (CONNECT-014)

Other systems use application credentials, not people's sessions. The owner issues one per system on **Access**
(`/app/access`): a name, one audience, optional teams (none: the whole business) and an expiry of 1-90 days. The token
`beam-app-v1.<id>.<secret>` is shown once and stored only as a SHA-256 digest; rotating replaces the secret at once and
revoking ends it. A credential an installation restore brought back shows state `restored` and authenticates again only once the owner rotates it (OPS-007: archives carry no verifier hashes; restored certificate and report links never work again, so create new ones). Send `Authorization: Bearer <token>` (no Origin is needed; a request that also carries a session cookie keeps the same-origin check). Each credential
answers only its audience's route below, inside its teams; every other route (publication, roles, access, another
audience, another team) is 403, a missing, revoked, rotated-out or expired token is 401, and more than 60 requests in a
minute is 429 `{ error: 'rate_limited', detail: { limit: 60, per: 'minute' } }`. Changes are audited under the
credential's name. Reads are cursor-paged: `?limit=1..200` (default 50) and `?cursor=<next>`; the answer is
`{ data: [...], next: string | null }` in a stable order. Preparation credentials (above) cannot call these routes.

- `roster.read` · `GET /api/beam/v1/people` → `data: [{ id, name, employeeId, jobRole, employment, teams: [teamId] }]`.
- `catalog.read` · `GET /api/beam/v1/courses` → `data: [{ id, title, publishedRevision }]` (published, not retired or archived).
- `reports.read` · `GET /api/beam/v1/report` (filters `course`, `team`, `status` as in `/api/beam/report`) → `{ summary, data: [report row], next }`, rows ordered by `assignment`. The BI feed (REPORT-004) on the same credential and filters, unpaged: `GET /api/beam/v1/report/feed.json` → `{ schema: 'beam.report-feed.v1', watermark, timeZone, filters, fields: [{ name, type, label }], deleted, restricted, summary, rows }` and `GET /api/beam/v1/report/feed.csv` (header row = field names; `X-Beam-Schema`, `X-Beam-Watermark`). Each refresh is a whole snapshot as of `watermark`.
- `results.write` · `POST /api/beam/v1/results` `{ learner, requirement, issuer, number, issuedOn, expiresOn?, file: { filename, base64, type } }` (JPEG, PNG, WebP, GIF or PDF) → `{ id, state: 'pending' }`: an external certificate waiting for its requirement's reviewer, never approved automatically.
- `mcp` · `/mcp`, also served at `POST /api/beam/mcp` (CONNECT-016): the shared Streamable HTTP MCP door supports 2026-07-28 and 2025-11-25. Existing grants keep their stored native choices: `search_material` grants scope/tool `beam.material.search` `{ query }`, `read_report` grants `beam.report.read` `{ team?, course?, status? }`, and `propose_course_change` grants `beam.draft.propose` `{ course, draftVersion, summary, draft, inputs?, passages?, missing?, idempotency_key }`. Call these names through MCP. Search returns permitted published lessons and cited source versions as untrusted data; reports remain inside the grant's teams; a draft proposal never publishes. Shared scopes narrow the grant to its selected jobs. A tool outside those scopes is refused with `insufficient_scope`. Owner policy setup on `/agents` is required even for an existing grant; this alias has no separate legacy policy path. A request carrying a session cookie is refused.
- `enrollments.write` · `POST /api/beam/v1/enrollments` `{ idempotencyKey, learner, course, dueDate, dueTime?, timezone? }` → `{ idempotencyKey, learner, course, dueDate, dueTime, timezone, created: [assignmentId], kept: [assignmentId], replayed }`. Replaying a key returns the first answer with `replayed: true`; the same key with a different enrollment is 409 `idempotency_key_reused`.

## Tests

Keep tests to flows a person would notice breaking, through public doors, one
check per clause, with fakes only at provider edges (there are none in phase
one). No pin tests (hashes, versions, file lists, UI copy, thresholds). Prove a
one-off fix with before/after evidence instead of a new permanent test.

## Overdue escalation (NOTICE-004)

Using an ordinary human owner session with the exact app Origin, read
`GET /api/beam/escalation-policy` (null before configuration), then
`POST /api/beam/escalation.policy` with
`{ "version": 0, "enabled": true, "reminderHours": 24, "managerHours": 48, "fallbackHours": 96 }`.
Use the returned version for later saves, including disabling. Delays are elapsed
hours from the original due instant, with reminder ≤ manager ≤ fallback.
The daily scheduled job sends each assignment/recipient/route at most once.
Learner reminders pause on leave; active deferrals/exemptions pause all sends.
Current temporary cover takes precedence over direct team managers; unavailable
managers or the fallback delay route to the owner. Directory manager_id grants
no authority. No email means no contact route; no SMS is simulated.

`GET /api/beam/queues` adds `escalations` within the reader's existing enrollment
scope: current routes, leave, no-contact, exhausted attempts, scheduled assessor
capacity, accepted/development mail facts and held/failed execution outcomes.
Accepted means provider acceptance, not delivered. Capacity counts only future
sessions named to the practical assessor, including unexpired reserved offers.
The manager or administrator currently in scope resolves with
`POST /api/beam/escalation.resolve` and `{ "assignment": "ID", "reason": "..." }`.
Resolution never rewrites the due date, assessment or completion.

A failed or held send never retries automatically. The owner explicitly replays
with `POST /api/beam/escalation.run` and `{}`; current policy, route, access,
leave, exceptions, completion and resolution plus AUTO-008 controls are checked
again. No unresolved work is sent after the policy is disabled. These are public
human API/form doors; preparation credentials cannot configure, run or resolve.

Escalation also supports AUTO-008's per-rule approval mode. Read the current
`automation-controls` policy version and post `automation.policy` with
`{ "version": N, "kind": "escalation", "rule": "overdue-work", "mode": "approval" }`
(or `automatic`). A held execution appears in `automation-controls`; only the
owner approves it with `automation.approve` (`execution`, current policy `version`),
then explicitly replays with `escalation.run`. A policy version change invalidates
prior approvals. Migration 0069 preserves every existing automation control.

## Installation archives (OPS-007)

`rer export` and `rer import` load `scripts/installer/portability-policy.mjs`: the archive replaces the verifier hash of
every application credential, certificate verification link and restricted report link with `withheld` and keeps the
rest of each grant as lineage. Migration 0070's trigger marks the grants a restore brings back (`restored_at`), so they
stay disabled until the owner rotates the credential or creates a new link. `tests/beam/regression-archive.mjs` proves
both through Base's portability export and restore.

## Reviewed source extraction (AUTHOR-002, partial)

Authors use Sources → Prepare lessons, or `GET /api/beam/sources/:versionId/extraction`,
for bounded DOCX/PPTX ZIPs, inert HTML, UTF-8 text/Markdown and PDFs. Extraction
retains immutable provenance, located original passages, editable tables and
accessible raster image assets; no remote document resources are fetched. Tagged
PDF authored order and bounded rectangular table spans, unambiguous repeated rows and package-local HTML ZIP images are preserved; complex
layouts and unsupported objects remain explicit warnings/gaps. The authenticated
original stays available beside the extraction. `source.convert` requires checked
comparison, resolved uncertainty ids, current draft version and source-bound
assets; it only creates draft lessons. Named human review still publishes.

Scanned PDFs require actual OCR. Only the human owner configures the sealed
OpenAI key at `/app/sources/ocr` and approves each source at
`/app/sources/:version/ocr`, after provider/model, immutable digest, USD estimate
and custody disclosure. Approvals expire, are consumed once, and do not survive
configuration changes. There is no automatic retry; failed/unknown billing keeps
its reservation. Archives withhold keys and restore disables OCR. The paid edge
is faked only in `regression-source-ocr.mjs`; `live-source-ocr.mjs` is the separate
held-key qualification. The adopted privacy/spending default needs ct approval.

## Retention and erasure (OPS-003, partial)

Settings → Retention and erasure is human-owner only. Save a justified employer
policy, place or release explicit holds, preview custody and consent to a fresh
inventory before starting. GETs never advance deletion. Each explicit resume
journals import/native/file/provider steps; practice replies are deleted even
when assessed evidence is held. Import custody includes uploads/chunks, plans,
approvals, scope and apply failures while permanent settings and revoked keys
remain. Personal audit payload/routes are redacted while decision ids and times
survive. Unmapped references/shared machine snapshots refuse execution. The owner may separately withdraw complete affected follow-on dry runs through the custody preview, with fresh digest consent; this pauses their rules and requires a new dry run before activation. Waiting/declined agent preparations without outcome dependencies may also be explicitly withdrawn; stored text is removed, original decision state and value-free lineage remain, old decisions are refused and the privacy checkpoint advances. Approved/dependent work and other shared snapshot classes remain refused. Provider
API deletion remains visibly unresolved, never reported as success. Reconnects
are fenced by installation-specific hashes; older restores require the later
trusted privacy journal. Journal loss, downloaded/native caches, derived cited
source content and provider propagation remain gaps, as does ct approval of the
adopted retention/custody policy. Do not describe this slice as complete erasure.

## Native lesson media (AUTHOR-001, partial)

Authors add/edit typed blocks with `course.block`, duplicate/reorder/remove with
`course.block.change`, and reuse a block from another course they author with
`course.block.reuse`. All carry `course`, `draftVersion`, and `lesson`; reuse's
`from` is `course:lesson:block`. The editor supplies these references. Reuse
copies content and exact source-version attribution; it never links mutable
content between published lessons. The editor's **Preview as learner** reads
its current draft through the same renderer as learners, without recording
progress. Practice checks reveal the answer and explanation; assessment and
completion decisions continue through the existing quiz and practical doors.

Source media is authenticated and byte-sniffed: native image, MP3 audio,
MP4/WebM video and PDF blocks use immutable source versions. Rich text supports
headings, lists, bold, emphasis and code without HTML. Active HTML in structured
blocks is refused; legacy plain lesson text stays escaped. PDFs offer an authenticated download and an optional scriptless sandboxed frame;
readable inline PDF rendering remains unproved (Chromium refuses the sandboxed
viewer). Source responses keep their restrictive CSP and nosniff.

Only the owner edits **Web content allowlist** on a course page (`embed.policy`,
`version`, newline-separated `hosts`). It starts empty. Exact HTTPS hostnames,
without credentials, custom ports or wildcards, are required; the application's
own host cannot be admitted. YouTube, Vimeo and Loom share URLs and Google
Slides/Docs editing URLs convert to embed URLs; Microsoft 365 uses the provider's
embed URL. Authors must use a host approved by the owner. Frames have scripts,
forms, presentation and cross-origin provider cookies inside their sandbox, with
no top navigation, popups or downloads. Only media pages permit the owner's
listed frame origins in CSP. Removing a host suppresses even previously
published frames immediately; it never changes their stored revision. A new
publication must pass current admission. Live provider playback is still owed;
synthetic URLs in HTTP/browser checks prove admission and isolation only.


## cmi5 package profile (PACK-004, partial)

The existing package editor also imports a ZIP with root `cmi5.xml`. The human
owner supplies `connection` (an explicitly consented xAPI LRS) and `consent: true`
with the existing license, immutable source citations and optional export
restriction. Only flat package-local HTML AnyWindow AUs are admitted; unsupported
blocks, remote launches, OwnWindow and unknown XML features receive a specific
validation diagnostic. Existing ZIP expansion/path/asset limits apply.

`package.launch` opens each assigned AU in the existing opaque sandbox; preview
uses Browse and refuses completion-related results. Launch parameters are the
standard `endpoint`, one-time POST `fetch`, `actor`, `registration` and
`activityId`. The fetch response's base64 `auth-token` is used as Basic auth;
it grants only that AU/session, expires with the current human session/access,
and cannot read/write another registration or expose the LRS credential.
`LMS.LaunchData` is read-only and provides the original moveOn/mastery rules and
context template. Resume JSON documents use GET and conditional PUT (64 KB per
document): a new document requires `If-None-Match: *`, an existing one its ETag
in `If-Match`. Reserved `LMS.*` writes are refused.

The bridge accepts individual attachment-free xAPI 1.0.3 statements through
`statements`. The AU initializes first, records Completed/Passed/Failed with the
cmi5 category, session, grouping, result and duration, and terminates last.
Launched, Abandoned, Waived and Satisfied are Beam's own LMS statements; an AU
that posts one is refused (`cmi5_lms_verb_forbidden`) before the LRS write.
Verbs cannot be duplicated with new ids; exact UUID retries deduplicate and
reconcile derived progress. Completed and Passed are distinct and can accumulate
across sessions in one assignment's course registration. Terminated ends the
session immediately; a replacement AU/session records Abandoned for interrupted
work. Native assessment gates still apply. The public learner record is
`GET /api/beam/cmi5-evidence/:assignment` and the existing package evidence page.
Learning export excludes capabilities; installation archives withhold them and
both modern/legacy restore disable access. ct approved this boundary as adopted
with riders, 22 Oct; no claim of general cmi5 conformance or browser-derived
competence. A learner erasure does not yet reach statements already written to
the connected LRS (OPS-003 partial).


## Five-day microlearning (AUTHOR-009, partial)

A course author saves `course.sequence` with `course`, `draftVersion` and
`sequence: { workStart, workEnd, workDays, days }`. Work hours are whole hours,
start inclusive/end exclusive (end 24 means next midnight); workDays uses Sunday
0 through Saturday 6 and defaults to Monday–Friday. Exactly five days name
five distinct draft lesson ids, each short and citing source versions. Each day
has `prompt` and 2–4 `choices: [{label, feedback, next: 'retry'|'continue'}]`,
including at least one retry and one continue. The existing course editor
supplies these fields; remove from draft with `remove: true`. Normal draft
version, course authority and named human publication rules apply. Submission
maps the selected lessons into the exact immutable revision ids.

`/app/courses/:course/sequence?channel=web|sms|teams` previews the draft; add
`revision=:id` to inspect a review/published snapshot. The SMS text and Teams
Adaptive Card payload are local representations, not proof of provider
rendering, sending, receipt or messaging reply. No provider call is simulated.
The learner opens `/app/learn/:assignment/sequence` or reads
`GET /api/beam/sequences/:assignment`. `sequence.pause` takes `assignment`,
`version` and `pause: true|false`; `sequence.answer` adds the current `day` and
zero-based `choice`. Both require that learner's live human access. Releases
advance one reviewed workday at a time in the assignment zone; pause shifts the
release anchor by elapsed paused time. Conditional versions and a unique
continued-day record prevent duplicate advancement. Reply evidence and native
lesson progress commit together; all existing required assessments still gate
completion. The full web course remains available for voluntary learning.
Only the learner and owner inspect personal reply text; no manager permission
is added. Practice replies never enter the shared audit; continuation records only
the existing lesson-complete event, without a choice or feedback. The learning export retains program, pause state and exact-revision
replies. Course restore and approved locale publication preserve program
structure. Real SMS/Teams send/reply/consent qualification remains blocked on
unprovisioned provider prerequisites under LEARN-012/NOTICE-003. ct approved
this boundary as adopted with riders, 22 Oct. Learner erasure of practice
replies (`beam_sequence_answers`) are removed by the owner erasure door, even while assessed evidence is held. OPS-003 remains partial for its named custody/propagation gaps.

## Scoped operational evidence and overdue recovery

Humans authorize `error-feed.authorize` with `course`, `jobRole`, `teams` and
`consent: true`. The Error diagnosis page provides the same form. Supply its
`feed` to `outcome.import` with `purpose: diagnosis` and the existing CSV fields,
or `records: [{ id, employeeId, date, value }]`. Record ids are opaque identifiers,
not personal detail; extra record fields are discarded. `error-feed.revoke`
with `feed` withdraws all of its evidence. Current authority and cohort shrink
invalidate affected comparisons before release. Agents prepare diagnoses from
these minimized human imports; they cannot authorize, import or revoke feeds.

A human current direct manager reports a bounced learner delivery using
`recovery.delivery` with `assignment`, `team` and the existing delivery `message`
id. Reports are labelled human-reported and cannot set an earlier timestamp.
Prepare overdue work with `agent.propose`, `kind: process_change`, and
`payload: { recovery: { assignment, team, substitute, expiresOn } }`.
Only the owner or a current direct manager approves the exact proposal. Approval
grants existing temporary coverage and runs that assignment's existing controlled
escalation. It retains original dates and assessment evidence. A full calendar or
unknown return date remains visible for the substitute to resolve during paid
work. No automatic slot, exception, completion or backdated evidence is created.

## Frontline web credentials (ORG-011, partial)

The human owner enables the JSON-only web method with `frontline.policy` and
`{ enabled: true }`; it starts disabled. The owner provisions a person who has
an employee id using `frontline.issue` with `member`, `username` and
`mode: password` or `pin`. It returns one initial secret once, expiring after
the configured initial lifetime (seven days by default). A current team manager may reset an already-provisioned teammate
through the same action; every reset ends existing sessions and audits actor,
subject, method and expiry without secrets. `frontline.unlock` clears lockout
within the same scope. Owner and current unit administrators keep workplace
recovery. ct approved this provisioning boundary as adopted, 24 October.

Post JSON to `/auth/frontline` with exact Origin, `username` and `secret`.
First use also requires `newPassword`: at least fifteen characters for a password
or six numeric digits for a PIN. The initial secret is consumed atomically.
The returned Base cookie signs the learner into the ordinary learning doors;
there is no new sign-in screen yet. The owner may set `passwordEnabled` and
`pinEnabled` independently through `frontline.policy`, and `initialDays` from
1 to 30. Disabling a method revokes its existing sessions permanently. The global
`enabled` switch remains the kill switch. Five failed guesses lock the person for
fifteen minutes; thirty requests per ten-minute network window are allowed.
Password material uses salted PBKDF2-SHA-256 with 100,000 iterations, the Worker
WebCrypto limit. Method disabling ends local password sessions; reset, access
removal and termination invalidate earlier sessions. Rehire never restores the
old credential. Accounts without email use a non-deliverable internal key and
never receive magic-link mail. Archives exclude credential rows and method
activation; learning exports use their existing explicit inventory.

People and sign-in UI, sheets and QR codes, device throttling, SMS, shared tablets, native apps and HRIS
enrollment remain gaps; this is not the complete ORG-011 journey.

## Roster feed preparation (CONNECT-019, partial)

The human owner creates a saved mapping through `roster-feed.create` with
`name`, ordered `headers` and `mapping` arrays, `intervalMinutes` from 15 to
1440, and `terminationLimit` from 1 to 100 (percentage of rows). Mapping values
are the existing roster target names, or `ignore`. Configuration is immutable;
create a new feed to approve a changed schema. Automatic mode is unavailable.

Post `feed` and a CSV or XLSX `file` to `roster-feed.receive`. The exact ordered
headers must match. The result names a durable receipt, a hold reason and,
where schema matches, an ordinary roster `batch`. All uploads wait for human
review; no invitation, missing-person deactivation or automatic apply occurs.
The owner inspects the existing roster preview and explicitly uses
`people.batch.apply` to apply selected rows. Existing validation, resumability,
erasure fences and audience synchronization still apply. Repeated bytes on the
same feed return the original receipt and never create another batch. Interrupted
preparation remains visible; no hidden retry or unattended action occurs.

`GET /api/beam/roster-feeds` returns saved mappings, recent receipts and whether
the last schema-valid arrival is overdue by the configured interval. A renamed
column does not clear staleness. Schema changes, ambiguous or invalid rows and
termination percentages above the limit have distinct hold reasons. This is
manual preparation, without an SFTP service, cloud watcher, scheduled apply,
AUTO-002 lifecycle enrollment or a configuration screen. ct approved owner-only explicit
review for every file as adopted, 24 October; no invitations, unattended provider calls or automatic application. A feed preview cannot be changed to enable invitations.
