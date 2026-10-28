# Review current requirements before migration cutover

The current TalentLMS importer moves labeled history, not a complete learning estate. Source assets, content rights, certificates, playable packages and the other incumbent formats still require their separate migration work. A completion report does not say which training is currently required.

An owner can include an employer-reviewed sidecar when uploading an import bundle. This is Beam's documented sidecar format, not a claim that every TalentLMS tenant exports these columns:

```csv
Email,Course ID,Active,Due date
learner@example.test,101,true,01/10/2030
```

`Course ID` must appear in the course list and use its reviewed Beam mapping. `Active` is true/false or active/closed. Dates follow the selected import date format; a blank due date leaves that comparison unspecified. The sidecar is limited to 5,000 rows and retained with the original bundle. Duplicate identities, unreadable dates, unknown courses, unmatched people and unsupported extra columns are named for resolution. Resolve people through People and re-preview the original bundle; the new retained interpretation still needs review and normal fingerprint-bound apply. Do not remove an unsupported column until the employer has explicitly resolved the information it carries.

After applying the latest completed plan, open **Review current-requirement shadow** on Move in, or read `GET /api/beam/cutover/:plan`. The comparison shows source/current counts, identity and course mapping, active or closed requirements, current published revisions, due dates, open assignments, current native evidence and approved imported-history credit. It names every unmatched row or difference and any extra open Beam assignment for a mapped course. A missing sidecar prevents approval.

Imported-history credit is pending until a qualifying existing credit decision was made after this import, or the owner explicitly declines its use for the mapped course with a reason. The decline does not create credit, assignments or completions. The full credit-review flow remains MOVE-009's obligation.

Only a current human owner reviews this limited shadow. Approval requires every difference resolved, explicit consent and a reason; the exact source fingerprint and current data state are checked atomically. Changing an import, access, course revision, assignment or credit decision requires new review. The server retains decision identity, time and digest; it does not retain another personal snapshot. Restore keeps the lineage disabled. Normal importer resume, completed-apply replay and selective undo remain available; later reviewed history is preserved during undo.

This approval creates no enrollments, provider calls or HRIS activation. First actual HRIS enrollment must enforce the reviewed cutover and credit-before-enrollment obligation under AUTO-002/CONNECT-002. That door and its BambooHR tenant qualification are not provided here. Owner-only review and explicit credit-decline semantics remain conservative defaults pending policy approval. MOVE-008 is partial until the full-estate and first-sync obligations are qualified.
