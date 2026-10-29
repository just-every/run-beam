Your own AI agent can prepare work in Beam. Its preparation stays separate from publishing, assigning learning and deciding assessments. People use the existing Beam screens to decide prepared work. Model-assisted features have their own owner-configured provider and consent requirements; this agent door does not authorize provider calls.

## What an agent can prepare

- **Course drafts**, with the source passages they rely on and what is missing.
- **Assignment plans**: who should take which course, and by when.
- **Reminders** for open assignments.
- **Question plans**: optional questions for staff, with answers shown without names.
- **Process changes** for a manager to decide.
- **Practice scenarios** for a course.
- **Draft lessons, blocks, questions and assessment rules**, including submission for a person's review.
- **Source-impact proposals, diagnoses and measurement plans**, within the existing preparation permissions.

## Give your agent access

Connect an MCP client to this installation's `/mcp` endpoint, supporting MCP 2026-07-28 and 2025-11-25. `/api/beam/mcp` is an alias of the same shared door. The bounded surface exposes existing preparation jobs and the existing scoped material search, report and course-proposal jobs. Each call still checks the sponsoring person's current Beam roles, content rights and team scope. A credential cannot add authority its sponsor lacks.

On a paired installation, Business supplies the short-lived, audience-bound credential after its person-to-account mapping is in place. Local compatibility credentials remain narrowly scoped: a preparation credential issued from an ordinary email-link or OIDC session lasts no more than an hour or its parent session, and signing out or removing access revokes it. An application credential keeps only its existing named MCP jobs and teams. Neither grants publication, assessment decisions, people administration, provider access or policy control. Dev and review sessions cannot issue preparation credentials. Keep bearer credentials private and separate from browser cookies. The existing JSON preparation API remains described in [AGENTS.md](https://github.com/just-every/run-beam/blob/main/AGENTS.md).

The owner must explicitly choose the company policy on `/agents` before agent preparation can run; no disposition is preset. Preparation REST calls use the same shared invocation policy as MCP calls. An unset policy returns `policy_unset` and a setup link without changing learning state. A policy can allow preparation to run, add it to review, hold it for exact approval or block it. An approval of an MCP preparation call permits that preparation only; it does not approve the resulting native proposal or publish the draft.

Use **Agents** for the shared policy, invocation audit, pending approvals and review feed. Only a signed-in person can answer policy questions, approve exact saved work, mark it reviewed, or pause and resume agents. **Pause agents** stops agent calls; ordinary human learning and the separate native automation controls retain their own behavior. A mutating tool requires an `idempotency_key`; reuse it for the same work after an interrupted response. Reusing it with changed arguments is a conflict. Where a tool exposes `expected_revision`, stale work must be prepared again against the current revision.

The agent door runtime is pinned to Base `2135c394939f4a737adabdc8003b0e667b31ac5a`, with the released `@runeditrun/rer` 0.2.91 CLI. The declared Core journey passed all 3,651 BASE-AGENT points through normal `rer verify` on 29 October 2026. The runtime also passed the focused native sponsor-recovery journey. The broader ct surface remains partial. Record resources, prompts, events and subscriptions are undeclared and return a typed capability refusal. Publication, enrollment, native decisions, automation and provider tools remain outside this preparation registry. The full ct learning-coordinator week, its broader native job catalogue, optional families, provider budgets and stranger-specialist acceptance remain work in the contract. Multi-sponsor Business delivery, mail edges, resource refresh, timed and queued lifecycles, dual host and owner-native administration are unscoped by this subset.

## MCP tool inventory

The current declarations below come from `src/beam/agent-door/tool-specs.ts`.
Each scope is exactly the tool name. Classes are possible classes, computed by
the server for each call; the table is not evidence that every class fixture or
clause acceptance has passed. A clause mapping identifies the native job that a
tool supports, not complete coverage of that clause. Write tools require an
`idempotency_key`; draft editing and proposals also retain their native version
requirements. Use `tools/list` for the admitted tools and their input/output
schemas under the current credential and policy.

| Tool and scope | Operation | Possible classes | Clauses |
| --- | --- | --- | --- |
| `beam.identity.read` | Read | `sensitive` | `BEAM-01` |
| `beam.members.list` | Read | `standard` | `BEAM-01` |
| `beam.sources.list` | Read | `standard` | `BEAM-02` |
| `beam.courses.list` | Read | `standard` | `BEAM-03` |
| `beam.course.read` | Read | `standard` | `BEAM-03` |
| `beam.revision.read` | Read | `standard` | `BEAM-03`, `BEAM-07` |
| `beam.source.read` | Read | `standard` | `BEAM-02` |
| `beam.people.list` | Read | `sensitive` | `BEAM-01`, `ORG-004` |
| `beam.paths.list` | Read | `standard` | `BEAM-04` |
| `beam.report.read` | Read | `sensitive` | `BEAM-13`, `BEAM-17`, `REPORT-001`, `CONNECT-016` |
| `beam.proposals.list` | Read | `sensitive` | `AGENT-001` |
| `beam.proposal.read` | Read | `sensitive` | `AGENT-001` |
| `beam.impact.read` | Read | `standard` | `AGENT-004` |
| `beam.questions.read` | Read | `standard` | `BEAM-19` |
| `beam.diagnosis.read` | Read | `standard` | `AGENT-002`, `AGENT-003` |
| `beam.material.search` | Read | `standard` | `BEAM-02`, `CONNECT-016` |
| `beam.course.create` | Write | `standard` | `BEAM-03` |
| `beam.course.save_details` | Write | `standard` | `BEAM-03` |
| `beam.course.save_lesson` | Write | `standard` | `BEAM-03` |
| `beam.course.remove_lesson` | Write | `standard` | `BEAM-03` |
| `beam.course.move_lesson` | Write | `standard` | `BEAM-03` |
| `beam.course.save_block` | Write | `standard` | `BEAM-03`, `AUTHOR-001` |
| `beam.course.change_block` | Write | `standard` | `BEAM-03`, `AUTHOR-001` |
| `beam.course.reuse_block` | Write | `standard` | `BEAM-03`, `AUTHOR-001` |
| `beam.course.save_question` | Write | `standard` | `BEAM-03`, `BEAM-07`, `LEARN-001`, `LEARN-015` |
| `beam.course.remove_question` | Write | `standard` | `BEAM-03` |
| `beam.course.save_assessment` | Write | `standard` | `BEAM-03`, `BEAM-07`, `BEAM-08`, `LEARN-001` |
| `beam.course.save_survey` | Write | `standard` | `BEAM-03`, `LEARN-001` |
| `beam.course.submit` | Write | `standard` | `BEAM-03` |
| `beam.draft.propose` | Write | `standard` | `BEAM-03`, `BEAM-14`, `AGENT-001`, `CONNECT-016` |
| `beam.impact.propose` | Write | `standard` | `AGENT-004` |
| `beam.preparation.propose` | Write | `standard` | `BEAM-18`, `BEAM-19`, `BEAM-20`, `AGENT-001`, `AGENT-003`, `AGENT-006` |
| `beam.outcome.plan` | Write | `standard` | `AGENT-005` |
| `beam.diagnosis.prepare` | Write | `standard` | `AGENT-002`, `AGENT-003` |

The three existing application-grant choices keep their stored names:
`search_material` maps to `beam.material.search`, `read_report` to
`beam.report.read`, and `propose_course_change` to `beam.draft.propose`. Their
shared scopes permit only the selected jobs and existing team boundary. A
preparation credential does not inherit those application scopes merely by
using the MCP endpoint.

Microsoft-backed material that requires a live rights check returns `provider_check_requires_human_door`. The source catalogue refuses while an available Microsoft source would require that check. Use the existing native human door for that material; this registry declares no additional provider edge and registers no provider cost or paid operation.

## Approve or decline

Open **Agent work**. **Waiting** lists every proposal with who prepared it and from what, the **Reasons**, anything **Excluded**, and a **Preview** of exactly what approving will create. Add a note if you like, then **Approve** or **Decline**. Approved and declined proposals keep the decision, the note and what it created.

Course drafts are decided on their course page, and a practice scenario is deployed by the course's reviewer.

## Questions for staff

An approved question plan appears to the people it asks under **Questions for you**. Answering is optional. Answers are shown to the manager without names, only after the questions close and only if at least three people answered. They are never used to rate anyone.

## Measuring an intervention

Before you decide an intervention, choose how its effect on work will be measured on its card under **Measuring the outcome**: the outcome and its unit, whether lower or higher is better, a baseline period and an after period, whether the rest of the role is the comparison group, and the smallest group whose result is shown (at least 3). Your agent may prepare this plan; only a person approves it. Once the intervention is applied, import the outcomes as a CSV with **Employee ID**, **Date** and **Value** columns (a blank value counts as missing) and note any process changes in those periods. Beam keeps only rows for people you manage in the two periods and lists every other row it refused.

The comparison shows each group's before and after averages, its change with an approximate 95% interval, the difference from the comparison group, missing data, process changes and small-sample limits. It is shown for groups only, to the owner, the manager who approved the plan and managers whose teams include its people. A group smaller than the bound, or one that differs from an earlier plan's group by fewer people than the bound, is hidden. It never ranks or lists anyone, and does not claim the training caused the change: completion proves neither competence nor causation.

Once the after period has ended, the owner or the manager who approved the plan chooses **Close the measurement and evaluate**. Beam prepares the evaluation by rule, not by a model: improved, no observed improvement, worse, or not measurable, from whether the interval of the difference (or of the group's own change, without a comparison group) lies on the better side of zero, includes it, or lies on the worse side. It names process changes recorded in the periods and offers alternatives: revised practice, a process fix and, unless the outcome improved, retiring the intervention's assignments that are still open. No more outcomes can be imported once it is closed, and the finding stays on the card. Retiring is your decision: tick the open assignments of people in your teams and choose **Retire the selected assignments**. Each is cancelled with the evaluation as its reason; completed assignments, completions, certificates and outcomes never change.
