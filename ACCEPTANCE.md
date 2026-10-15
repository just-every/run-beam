# Beam first release and acceptance

**Useful outcome:** an operations lead publishes one procedure revision,
assigns it to a cohort, assesses completion and retrieves the exact course and
completion evidence. It runs locally with no provider account: sign-in through
the development outbox, uploads to local R2, native lessons, deterministic
quizzes, named-assessor decisions, in-app queues and reminders, CSV and
archive downloads. [CONTRACT.md](CONTRACT.md) holds clauses BEAM-01 to BEAM-20.

## How each clause is proven

| Clause | What a person can do | Test |
| --- | --- | --- |
| BEAM-01 | The owner names the business and zone, invites adult staff with roles and teams, and removes or restores access | `flows.mjs` BEAM-01 |
| BEAM-02 | An author uploads owned sources with licence evidence, provenance and a reviewer | `flows.mjs` BEAM-02, `journey.mjs` |
| BEAM-03 | An author drafts a course; only its named reviewer publishes a revision, by the human form | `flows.mjs` BEAM-03, `regressions.mjs`, `journey.mjs` |
| BEAM-04 | A manager builds role paths with prerequisites and renewals | `flows.mjs` BEAM-04, `journey.mjs` |
| BEAM-05 | A manager assigns people and teams with a due time in a named zone | `flows.mjs` BEAM-05, `journey.mjs` |
| BEAM-06 | A learner resumes on another device at the next lesson | `flows.mjs` BEAM-06, `journey.mjs` |
| BEAM-07 | A learner takes a deterministic quiz; a manager grants a retry with a reason | `flows.mjs` BEAM-07, `journey.mjs` |
| BEAM-08 | A learner submits practical evidence; only the named assessor decides | `flows.mjs` BEAM-08, `regressions.mjs` |
| BEAM-09 | Completion is recorded only against the exact revision, and survives later revisions | `flows.mjs` BEAM-09, `journey.mjs` |
| BEAM-10 | A manager records instructor-attested offline training for a chosen revision | `flows.mjs` BEAM-10, `regressions.mjs` |
| BEAM-11 | Learners and managers open numbered certificates | `flows.mjs` BEAM-11, `journey.mjs` |
| BEAM-12 | Learners see reminders; managers, reviewers and assessors work their queues | `flows.mjs` BEAM-12, `regressions.mjs` |
| BEAM-13 | Nobody reads another learner's records | `flows.mjs` BEAM-13 |
| BEAM-14 | A reviewer handles source changes and decides course-draft proposals with their passages and gaps | `flows.mjs` BEAM-14 and BEAM-18, `regressions.mjs` |
| BEAM-15 | The owner previews, applies, repeats and undoes a TalentLMS records import | `flows.mjs` BEAM-15 |
| BEAM-16 | The owner exports the whole installation and restores it into a fresh clone | `journey.mjs` (`restore.mjs`) |
| BEAM-17 | A manager filters the training report and downloads the same rows as CSV | `flows.mjs` BEAM-17, `journey.mjs` |
| BEAM-18 | A manager approves or declines the agent's assignment plans and reminder drafts | `flows.mjs` BEAM-18, `journey.mjs` |
| BEAM-19 | A manager approves a question plan; staff answer or decline; answers come back nameless | `flows.mjs` BEAM-19, `journey.mjs` |
| BEAM-20 | A reviewer deploys an agent-prepared practice scenario; learners practise it unscored | `flows.mjs` BEAM-20, `journey.mjs` |

`rer verify` checks the source lock and Base copy record, builds, typechecks
and runs `tests/email-link.mjs`, `tests/beam/flows.mjs` and
`tests/beam/regressions.mjs` against the built Worker with real local D1 and
R2. `BEAM_TEST_CHECKOUT=1 pnpm run test:journey` runs in a disposable fresh
clone through `rer` (describe, check, install, setup, dev with dev identity and
personas, build, preview, deploy --dry-run, export, import) and screenshots
every main screen at 1440 and 390 pixels (into `BEAM_EVIDENCE_DIR` when set).
GitHub `Verify` runs both. The agent in the tests is a real preparation
credential; no model or provider is faked because none is called.

## Upgrade and recovery

Beam has no released installation yet. Applied migrations 0001–0007 keep their
original bytes; 0008–0015 add the current Base auth, owner-claim and import-kit
schema, and 0016 the agent work, reminder, question and practice tables. The
first change to an applied migration's tables after a release owes a
populated-installation upgrade check. Restore an export with the release that
made it, then upgrade with `rer install` and `rer setup`.

## Preserved obligations (not accepted yet)

- An owner-data trial with a real TalentLMS course list, course reports and
  roster, with missing assets visible. The kit is proven on documented-shape
  invented fixtures; TalentLMS documents what the exports contain but not their
  exact header spellings, so header aliases are a best reading until a real
  export is checked.
- A real cohort completing one reviewed procedure, with the measured effort
  compared against the owner's current process (the incumbent LMS, and Moodle
  plus an agent), including content upkeep.
- Phase two: the owner's model account inside Beam for course preparation and
  coaching, and mail credentials for approved reminders.
- Later move-in kits: Trainual PDFs, 360Learning JSON, Moodle `.mbz`,
  authoring packages. Package (SCORM) playback is a separately proven outcome.
- Hosted operation in the owner's Cloudflare account and real mail delivery;
  the naming decision before public release.
- An accessibility audit. Pages are plain server forms with no client script;
  the style pass is still to come.

Beam issues the business's own completion certificates. It does not claim
accreditation, statutory or safety compliance, or that a quiz pass or practice
run shows practical competence.
