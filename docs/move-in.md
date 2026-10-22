Beam brings TalentLMS course lists and course-report history into the employer's own installation. Imported history never satisfies a current assignment and course content still needs rebuilding from owned source documents.

## Upload and review

Open **Move in** as the owner. Choose a course-list CSV and up to three report XLSX files on the screen (the API accepts five), their TalentLMS course IDs and optional replacement Beam courses, and the source date order. **Preview import** uploads the original files in bounded parts through Base's operator import door; JavaScript is required for that upload. Only this page permits the same-origin static uploader script and same-origin chunk connections under CSP; inline, eval and external scripts or connections remain forbidden. Planning retains originals and a review plan but writes no native training records.

Review the source/effect counts, rejections, explained omissions and differences. **Apply reviewed import** approves that exact fingerprint. If there is more work, **Continue reviewed import** applies the next bounded part. A changed or stale plan must be reviewed again; no hidden retry loop applies it.

The original bundle is JSON containing `courseList: {filename, base64}`, `reports: [{course, file: {filename, base64}}]`, `dateFormat` (`DMY`, `MDY` or `YMD`) and `mappings` keyed by TalentLMS course ID. The CSV/XLSX originals stay inside the retained bundle. Employee matches and course mappings are included in the reviewed interpretation. Unknown people remain explicitly unresolved history. Duplicate completion rows and non-completion events remain explained omissions.

## Reconcile, catch up and undo

**Check native records** compares the imported records with their retained sources. A manager can mark a history row reviewed; undo preserves that later decision. **Undo this import** uses bounded parts too. Import history identifies owner approvals and approvals made through Business separately.

Choose **Update the previous TalentLMS import with this export** to plan a catch-up against the same lineage. Review the differences before applying. Catch-up replaces only unchanged imported records; later native reviews or edits are protected and reported. No import grants sign-in access, publishes a course or sends a message.

## Business imports

To count imported completions as current on cutover day, the owner or the learning administrator of the course's unit decides one credit per mapped course. `credit.preview` with `{ course, intervalDays }` writes nothing and lists who would be credited (the latest matched completion per person) and each exclusion with its reason: `expired` (older than the interval), `unmatched` (no Beam person), `native_current` (a current Beam completion always wins) or `already_credited`. `credit.approve` with the same fields and a written `reason` records the decision; each credited person counts as current on **Compliance coverage**, "credited from TalentLMS history", until the completion date plus the interval in your business time zone, then expiring and missing. `credit.undo` with `{ credit, reason }` ends it. Credits never change imported rows, assignments or completions, and agents cannot decide them. The import-step screen, renewal scheduling from credited expiries, enrollment suppression and transcript lines are still to come.

Owner imports and Business use the same upload → plan → reviewed fingerprint → apply → reconcile → undo pipeline. Self-hosted Business imports start disabled and require the installation's configured trusted claim key ring. Enable or disable them on **Move in**. On a Business-provisioned installation, RER's server-owned `RER_IMPORT_DOOR=on` approval enables the door after the first owner claim. Later owner paths heal a missed enable step; none reopens a door the owner disabled. Grant and signed-claim verification share the configured RER claim app origin and key ring. Revoked key IDs stay revoked after re-enabling, and the owner's own history and undo remain available while Business is off.

## Custody and erasure

The installation archive retains import custody along with native history. Custody includes upload chunks, retained plans, approvals, namespace/destination bindings and failed-apply facts. Beam's employee-erasure door is still an OPS-003 gap: it must cover these records and every erase path before it ships, while retaining permanent settings and revoked signing keys.

## Imports from before the shared door

These remain labeled **Legacy owner import**, with original files, fingerprints, principal bindings and review decisions unchanged. No Business approval is invented. The current owner can undo them while Business is off, one bounded step per click. Interrupted old imports can only be discarded; they cannot resume forward. The original undo policy still protects later native edits.
