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

POST `/api/beam/portal.invite` with `portal`, `email`, `name` and
`sendInvitation: true`. Only the human owner may do this. A new account receives
Base's ordinary verified invitation; an existing active account keeps its current
sign-in and authority. The account gets a separate opaque identity in each
external portal. No employee membership, role or team is created. The portal
identity stores the verified account id, not an email match to an employee.
An employee email without an existing verified account binding is refused, so
a portal invitation cannot activate an unlinked employee roster record. A person
with existing employee access retains that independently granted access.

The invited learner GETs `/api/beam/portal/PORTAL/consent` to read the immutable
portal consent notice and POSTs `accept: true` there to accept. Each portal needs
its own explicit consent. POSTing `withdraw: true` there clears consent and
revokes portal administration; renewed consent never revives that grant. POST requests require exact Origin and an ordinary
human session; application and agent bearer credentials are refused.

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
Archives disconnect portal identities from accounts, clear consent and revoke
administrator grants. Rebinding restored identities is not implemented yet;
restoration never silently reactivates them. Owner learning exports include
portal and enrollment records without external identity account bindings or administrator grants.

Conservative defaults above are adopted pending ct approval. Full external
learning, portal UI, erasure workflows, branded downloads,
completion evidence and browser isolation proof remain owed. OPS-003 inherits
the external identity retention and erasure obligation; ORG-009 retains hostname
activation. This preparation feature must not be described as a finished portal.
