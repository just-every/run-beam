# Enterprise portal preparation

ORG-008 is partial. The JSON preparation APIs keep external portal identities,
consent, administrator grants and enrollment plans apart from employee membership.
They do not deliver external lessons or assessments and never record completion.
No portal page or hostname activation is available yet.

The human owner first configures the existing Settings theme. POST
`/api/beam/portal.create` with `kind` (`employee`, `customer` or `partner`),
`name`, `consentText` and `confirm: true`. One employee portal is allowed.
Each portal snapshots the validated theme. Later employee-theme changes leave
that snapshot intact. GET `/api/beam/portals` lists portals for the owner.
The owner independently edits a portal theme through `/api/beam/portal.theme`
with `portal` and the existing theme fields. Contrast and raster admission use
the same ORG-009 validation. Other portal themes stay unchanged. Portal logo
delivery remains unbuilt.

The human owner explicitly shares a published revision by POSTing
`/api/beam/portal.share` with `portal`, `revision` and `confirm: true`.
Adding `revoke: true` removes catalog admission and new enrollment. Sharing
exposes only revision title, number and identifier. It never exposes sources,
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

The new-account invitation returns to a read-only claim API response naming the
pending identity; opening it never binds or accepts consent.
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
the same enrollment returns the existing plan. Reports contain enrollment plans,
never inferred progress or completion. Learners may GET their portal's `catalog`
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

CT approved the identity and consent policy with riders on 26 October 2026.
The implemented API portion does not prove the complete policy or legal compliance. Full external
learning, portal UI, erasure workflows, branded downloads,
completion evidence and browser isolation proof remain owed. OPS-003 inherits
the external identity retention and erasure obligation; ORG-009 retains hostname
activation. This preparation feature must not be described as a finished portal.
