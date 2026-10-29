# Microsoft connections

The owner opens **Settings → Microsoft connections**. Workplace identity and
procedure sources use separate approvals; enabling one does not enable the other.

## Server configuration

The installation administrator supplies `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` and
`ENTRA_CLIENT_SECRET` as server bindings. Workplace provisioning also needs a
separate random `ENTRA_SCIM_TOKEN` of at least 32 bytes, configured both on the
server and as the Entra provisioning bearer token. Keep these values in the
installation’s secret manager. They never belong in source files, browser forms,
logs, learning data or installation archives.

The application needs the Microsoft Graph permissions for the operations you
use. Directory qualification reads users and assigned licenses. Document access
reads the selected site, its drives, document metadata, sharing permissions and
content. Use selected-site application grants where your tenant supports them.
Beam never changes a Microsoft document, its permissions or a license.

## Workplace identity

Pin the tenant and application to their server registration, record the reason
and explicitly authorize the connection. Enable identity sign-in in the
installation’s existing identity controls. Register the callback displayed on
the workplace identity page in the Entra application.

The displayed SCIM endpoint supports Users and Groups, exact identity filters,
bounded pagination, supported PATCH operations and deletion. Unsupported
attributes and operations are refused. New employees are separate from existing
Beam accounts: a matching email never silently links them. SCIM cannot assign
owner authority or change an existing owner.

The owner reviews each group’s learning roles. An unmapped group grants none.
The owner must also record authoritative evidence associating the employee with
the exact application-specific OIDC subject. An Entra object ID is not that
subject. Email, object and role claims in an ID token never supply this review.

Removing membership, changing reviewed authority, deactivating an employee or
withdrawing a subject association revokes existing sessions. Reactivation does
not revive an old session. Tenant and application changes fail closed. The
ordinary owner recovery route remains available. An archive restores this
connection disabled and removes sign-in associations; authentication must be
provisioned and reviewed again.

## Procedure sources

Check account availability first. App-only token and directory access do not
establish that a SharePoint site or licensed document library exists.

Authorize one exact site and document library, then browse its procedures or
enter an exact item ID. A folder listing states when it is incomplete. Preview
an unchanged original and its extracted passages. Confirm the license basis,
evidence and responsible reviewer before importing the exact snapshot. A stale
preview refuses instead of importing different bytes. The source keeps its
origin, version and permission snapshot. Office documents, PDFs and exported
HTML use Beam’s existing extraction; recognized media retains its unchanged
original for reviewed media blocks. Unsupported formats refuse explicitly.

Importing does not create a course or publish learning. Prepare and correct the
source using the existing course draft workflow, then submit it to the named
human reviewer. Checking for a changed source adds an immutable source version
and flags affected published courses for review.

Every retrieval rechecks the provider’s current site, library and sharing
permissions. Any permission change, denied read, disabled connection or uncertain
provider response withdraws that source. Old imported files, extracted passages
and cited learning stop serving. New publication and enrollment are refused.
Restoring provider permission does not silently revive the withdrawn source;
a new explicit connection approval and reviewed snapshot are needed.

Source rights and credentials remain disabled after an installation restore.
Learning archives retain historical evidence and originals under the employer’s
custody; provider-side deletion and redistribution outside Beam require their
own authority and qualification.

## Qualification boundary

These connections remain partial. The public HTTP tests use documented Microsoft
responses only at the network edge. The live qualification script,
`./tests/beam/live-microsoft.mjs`, performs a real token request, directory and
site-availability reads, OIDC discovery and authorization start, plus consent,
authority and local-disable refusals. It does not claim a live interactive
employee sign-in, tenant-driven provisioning or a licensed document lifecycle.
Those require the configured tenant’s administrator and actual authorized
SharePoint content. The adopted identity-linking and source-authority defaults
remain subject to contract policy approval.

Microsoft references: [drive item permissions](https://learn.microsoft.com/en-us/graph/api/driveitem-list-permissions?view=graph-rest-1.0),
[drive item content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)
and [directory users](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0).
