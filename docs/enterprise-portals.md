# Enterprise portal preparation

ORG-008 is partial. The JSON preparation APIs keep external portal identities,
consent, administrator grants and enrollment plans apart from employee membership.
Enrolled learners can read native text lessons and record isolated lesson progress.
Automatic assessments, server-timed quizzes and explicit completion are available for qualified native courses, with isolated certificate PDFs. Written grading and text practical review use the conservative named-owner floor described below. Other delivery methods remain unqualified.
Rendered claim, consent, catalog and native text learning pages are available.
Native learning pages use the independent portal theme and scoped raster assets. Hostname activation remains unqualified.

The human owner first configures the existing Settings theme. POST
`/api/beam/portal.create` with `kind` (`employee`, `customer` or `partner`),
`name`, `consentText` and `confirm: true`. One employee portal is allowed.
Each portal snapshots the validated theme. Later employee-theme changes leave
that snapshot intact. GET `/api/beam/portals` lists portals for the owner.
The owner independently edits a portal theme through `/api/beam/portal.theme`
with `portal` and the existing theme fields. Contrast and raster admission use
the same ORG-009 validation. Other portal themes stay unchanged. Portal logo delivery is available on the branded entry pages.

The human owner explicitly shares a published revision by POSTing
`/api/beam/portal.share` with `portal`, `revision` and `confirm: true`.
Adding `revoke: true` removes catalog admission and new enrollment. The catalog
exposes only revision title, number and identifier. Enrolled learners can separately
read the approved native text lessons described below. It never exposes sources,
draft material, employee records or answers. Enrollment keeps this exact revision;
a later publication does not silently move an enrollment.

The human owner publishes a complete disclosure with POST
`/api/beam/portal.notice`: `portal`, current `version` (zero initially),
`operatorName`, `purpose`, `collectedData`, `reportingRecipients`, `providers`,
`retentionAndHolds`, `certificateEffects` and `withdrawal`. All disclosure fields
are required. The response names the new `noticeVersion`. Notices are immutable;
changing one closes ordinary portal access and revokes grants until each learner
accepts that exact new version. Free-text `consentText` alone cannot activate access.
This disclosure does not assert a legal retention requirement or authorize provider calls.

POST `/api/beam/portal.invite` with `portal`, `email`, `name` and
`sendInvitation: true`. Only the human owner may do this. A new account receives
Base's ordinary verified invitation; an existing active account keeps its current
sign-in. The response names a pending portal identity with state `claim_required`.
The invitation records an intended account, with no live binding, consent,
employee membership or administrator authority. Employee collisions are refused
and audited, including already linked employees. Reviewed linking remains unbuilt.

The new-account invitation returns to the branded entry at `/app/portal/PORTAL/claim?identity=IDENTITY`.
The rendered claim page is read-only until the learner submits its claim form;
opening it never binds or accepts consent. The API claim response remains available.
After signing in through the ordinary verified account flow, the intended learner
POSTs `/api/beam/portal/PORTAL/claim` with the invitation's `identity`.
Only that stable account can claim it; the owner cannot claim on their behalf.
The claim checks again for an employee collision. An account email change keeps
the stable binding. Reusing its old delivery address creates another identity and
cannot claim the original invitation or inherit its records. A dev or review
session, a View as session and bearer credentials cannot use these portal doors.

The learner GETs `/api/beam/portal/PORTAL/consent` to inspect the complete notice
and its version, then POSTs `accept: true` and the exact `noticeVersion`.
Each portal needs independent explicit consent. The acceptance receipt retains
notice version, portal identity, verified account binding and UTC time.
POSTing `withdraw: true` clears consent and revokes portal administration;
renewed consent never revives that grant. Withdrawal remains available through
this authenticated door after the owner closes ordinary portal admission.
It leaves other portals untouched and preserves isolated enrollment plans.
It does not create completion or erase retained evidence. POST requests require
exact Origin and an ordinary human session.

After consent, the owner POSTs `/api/beam/portal.admin` with `portal` and
`identity` to grant administration. `revoke: true` withdraws it. Portal
administrators cannot grant themselves authority, invite accounts, share courses
or administer other portals. They can GET the portal's `roster` and `report`
doors and POST to its `enroll` door with `identity` and `revision`. Both values
must belong to that portal and current consent and sharing are required. Repeating
the same enrollment returns the existing plan. Reports contain enrollments with explicit `lessonsRead` and `totalLessons` counts,
assessment attempt totals, passing state and earned completion metadata. They exclude private answers. Learners may GET their portal's `catalog`
after consent. Unknown portal doors and downloads are refused.

The owner POSTs `/api/beam/portal.revoke` with `portal` and `identity` to end
that identity's portal access, including any administrator grant. This never
removes an independently granted employee role or another portal identity.
Archives disconnect both pending and bound portal identities from accounts,
clear active consent and revoke administrator grants. Restore enforces this
boundary even for archives written without the export policy. Historical notice
and consent decision records remain; receipt account bindings are removed. Rebinding restored identities is not implemented yet;
restoration never silently reactivates them. Owner learning exports include
portal and enrollment records without external identity account bindings or administrator grants.


## Rendered learner controls

An ordinarily signed-in invited learner opens `/portal/PORTAL/claim?identity=IDENTITY`,
claims their intended identity, and continues to `/portal/PORTAL/consent`. The complete
notice is shown before the explicit acceptance checkbox. An earlier displayed
version cannot accept a newly published notice; the learner must review it again.
The consent page also supports withdrawal without an owner decision, and remains
reachable after ordinary admission is closed.

`/portal/PORTAL/catalog` lists that identity's enrolled learning. Its links open
native text lessons, record reads, and download the learner's own lesson progress.
Withdrawing consent closes those pages and downloads. Fresh consent resumes the
same revision-bound progress and leaves the former administrator grant revoked.
Pages use Beam's existing components and visible control labels, with no employee
navigation or employee theme injected. Native learning pages use the same independent portal theme and scoped assets as the entry.
The ordinary push Verify runs the real claim, consent, learning, download and
withdrawal forms; its changed-screen evidence covers 1440 and 390.

## Native text lessons and progress

After consent and enrollment, the learner's catalog lists their own `enrollments`.
GET `/api/beam/portal/PORTAL/learning?enrollment=ENROLLMENT` returns the exact
approved revision, native text lesson titles and bodies, recorded read times,
`lessonsRead` and the first unread `resumeLesson`. It excludes source references,
source files, draft content, assessment answers and employee records. Lessons containing unsupported external blocks return `available: false` and no body. Approved local blocks are delivered through their scoped media doors. The matching `/portal/PORTAL/learning?enrollment=ENROLLMENT` page renders these
lessons and real mark-read forms. This remains a bounded native learning flow.

POST the same `learning` door with `enrollment` and `lesson` to record a native
text lesson as read. Only its enrolled learner can do this, independently of any
administrator grant. Reads of another identity's enrollment, a different portal
or an unshared revision are refused. The write transaction checks current account
binding, consent version, sharing and course availability again. Duplicate reads
preserve the original timestamp and append no duplicate audit decision. All-lesson
progress creates no employee assignment, completion, assessment result or certificate.

Later publication does not replace the enrollment's immutable revision, even when
that revision becomes superseded. An owner may explicitly share an approved
superseded revision. Enrollment in a later revision has independent progress.
Withdrawal closes learning, progress writes, personal downloads and ordinary
administrator reporting. Renewed consent resumes the same identity's retained
progress on the original revision, while administrator grants stay revoked.
Unsharing or retiring the course closes learning without deleting progress.

GET `/api/beam/portal/PORTAL/progress.json?enrollment=ENROLLMENT` downloads the
learner's own revision-bound lesson read receipt. The receipt omits lesson bodies,
source references, other identities and all authority. It is not a certificate.
The owner learning export and installation archive retain these isolated progress
rows. Both protected and legacy restores keep old identities disconnected; a fresh
invitation and enrollment cannot inherit their progress or read the old receipt.
External-identity erasure, retention decisions and provider propagation remain
unqualified under OPS-003.

CT approved the identity and consent policy with riders on 26 October 2026.
The implemented API portion does not prove the complete policy or legal compliance. Full external
learning, erasure workflows, advanced certificates
and the remaining enterprise journeys remain owed. OPS-003 inherits
the external identity retention and erasure obligation; ORG-009 retains hostname
activation. This preparation feature must not be described as a finished portal.

## Native assessments and earned evidence

The learner opens the contextual assessment link from enrolled learning, or GETs
`/api/beam/portal/PORTAL/assessment?enrollment=ENROLLMENT`. An untimed automatic
quiz becomes available after every enrolled lesson is read. It uses the immutable
assessment revision, question weights, pass mark, attempt limit and stable question
draw. Choice, blank, ordering and matching questions use the existing scoring rules.
Answer keys and assessor guidance never appear in the learner response.
Server-timed quizzes and the named-owner review floor are described below. Unsupported requirements remain completion gates.

POST the assessment door with `enrollment`, the displayed `number` and the existing
question answer fields. Each number consumes one attempt. Repeating a submitted
number returns its recorded lineage without scoring again; concurrent retries do
not create two attempts. Invalid answers do not consume an attempt. A new number
must be the next displayed number, within the revision's limit and before a pass.
GET `assessment.json` with the enrollment downloads that learner's own attempt
receipt, including submitted answers and results, without the answer key. Per-question results follow the immutable revision feedback rule: after each attempt, after passing or exhaustion, or score only. Withheld results stay out of the download.
Assessment progress, receipt downloads and reports close when consent is withdrawn,
the revision is unshared or the course is retired. Renewed consent preserves the
original revision and attempts without restoring administrator rights.

Passing the quiz does not itself issue course completion. The learner follows
Review course completion and explicitly records it through the rendered form, or
POSTs `/api/beam/portal/PORTAL/completion` with `enrollment`. Every native lesson
must have a read receipt, and any automatic assessment must have a passing attempt
on its original revision. A course with unqualified blocks, packages, external tools, xAPI requirements, a sequence or attendance cannot complete through this door. Timed quizzes must pass; any written answers require grading, and practical evidence requires acceptance. GET on the same door
shows qualification and any earned evidence. Repeating the action preserves the
original completion and certificate number.

GET `/api/beam/portal/PORTAL/certificate.pdf?enrollment=ENROLLMENT` downloads only
the enrolled learner's earned certificate. It snapshots the portal issuer, learner
name, course title, revision, assessment and evidence at completion; later course
publication cannot replace it. It creates no public verification link and sends
no notification. Withdrawal closes ordinary certificate access without rewriting
earned evidence; downloaded copies cannot be recalled. Renewed consent restores
access only to that identity's original evidence. Certificate corrections, expiry,
public links and independent branded assets remain unqualified.

The owner learning export and installation archive retain isolated formal attempts
and completions. Both protected and legacy restores disconnect identity and consent;
a freshly invited account cannot read or inherit the old attempts, completion or
certificate. Complete retained-record access, external erasure and readmission
remain subject to the Gaps in ORG-008.

## Branded entry and administrator exports

The branded entry remains at `/app/portal/PORTAL/claim`, with consent, catalog,
roster and report pages in that namespace. It serves each portal theme, logo and
favicon through authenticated scoped asset doors. My enrolled learning opens
the isolated native learning route described above. Portal administrators download only their current portal progress report through `report.csv`; withdrawals close ordinary report visibility. Native learning pages use the same independent theme and scoped raster assets.


## Approved media and timed assessment

Approved rich text, tables, practice checks, images, audio, video, captions, PDFs and
extracted images are delivered through the enrolled revision. The media door
`/api/beam/portal/PORTAL/media?enrollment=ENROLLMENT&lesson=LESSON&block=BLOCK`
authorizes the exact block and current admission before returning verified bytes.
Add `caption=1` for that video block's validated caption original or `download=1`
for an original download. Source ids, private source provenance and reuse
attribution are not exposed. External links, embeds, packages and tools remain
unavailable through this native door. Original media versions stay unchanged when
an author uploads a later source version. Withdrawal and unsharing close delivery.

A timed assessment starts with `operation: 'start'` and the displayed attempt
`number` at the ordinary assessment door. The response contains a server deadline,
version and saved answers. `operation: 'save'` or `operation: 'submit'` requires the
current version. Stale saves are refused. The deadline keeps running after leaving
the page or withdrawing consent. After expiry, the next authorized request scores
only previously saved answers; late fields cannot enter the result. A retry reads
the original result. Closed attempt receipts retain the server start, deadline, close time and close reason. External timing accommodations remain unqualified.

## Named-owner review floor

CT review is pending for this conservative interim rule. The current human owner
must also be the immutable assessment revision's exact named assessor. Ordinary
employee roles and portal administrator grants convey no private review access.
The full target still requires explicit assessor delegation.

Written answers remain awaiting review and cannot pass or earn completion until
the named owner grades them through `/portal/PORTAL/assessment-review?enrollment=ENROLLMENT`
or the matching API door. Each pending question receives bounded points and an
attributed review note. The decision is recorded once, and audit payloads omit
private answers and review notes.

The learner submits text practical evidence through the contextual Practical
assessment link. Repeating its submission token preserves the original evidence;
a rejected submission permits fresh evidence. The owner uses the contextual report
link to `/portal/PORTAL/practical-review?enrollment=ENROLLMENT`. Decisions append,
and one current submission receives one decision. Practical file attachments are
explicitly refused. Passing a quiz and accepted practical evidence remain separate
requirements; neither creates completion automatically. Withdrawal and unsharing
close private review and ordinary learner access while preserving isolated history.

## Progress reports

The existing portal report now distinguishes planned, in-progress and completed
enrollments and shows lesson counts, assessment attempts and passing state. Earned
certificate numbers and completion times come from immutable evidence, never from
an enrollment plan. Current portal administrators and the owner download the same
scoped progress CSV; private answers and source provenance are omitted. CSV quoting
preserves commas, quotes and newlines, and formula-prefixed user text is neutralized.
Withdrawal closes ordinary report visibility for that identity, and renewed consent
never revives a revoked administrator grant.
