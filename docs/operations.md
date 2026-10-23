# Installation health and provider controls

The human owner opens **Settings** to inspect current service readiness, scheduled-job outcomes and last successful runs, queue totals, provider failures and logical retained storage. The JSON read is `GET /api/beam/operations`. It contains aggregate operational facts, not credentials, request bodies or personal learning evidence. Readiness distinguishes configured services from qualified provider delivery. Directory records without an active sign-in account are counted separately from active people.

Current jobs are inactivity review, content review, overdue escalation, renewals and webhooks. A running task over ten minutes is labeled stalled or interrupted; the dashboard never automatically retries it. Manual Gusto language mappings without a successful pull in 24 hours are stale. These are manual language reads, not an HR roster feed. Future feeds/providers must add their own freshness and failure information.

Source originals admit at most 25,000,000 bytes per file. Roster previews admit 5,000,000 bytes and 5,000 rows and apply at most 50 rows per request, with explicit continuation. Package ZIPs admit 25,000,000 compressed bytes; supported standards and expansion limits still apply. Admission failures retain prior files and learning records; correct the file and retry. These are admission bounds, not a hosted throughput or storage-quota guarantee.

`tests/beam/capacity.mjs` is the standalone qualification journey for a 200-person employer with activated sign-in accounts, one cohort of 200 assignments, original image/audio/video/PDF media, SCORM, eight concurrent learners and two retained historical completions per person. It also refuses an oversized source, recovers with a bounded source and reconciles complete exports. Run it on a clean committed candidate outside push Verify. Its receipt describes the tested local built Worker; it establishes no hosted SLA, provider tenant capacity, production quota or universal package conformance.

Beam charges USD 0.00 for provider work. The employer separately pays its hosting/storage/egress account, model/media/mail/messaging providers and any content licenses at their current prices. Unknown account charges and quotas are unqualified, not zero. Confirm the provider's price, quota and agreements before use; this release does not calculate a complete employer ownership invoice.

## OCR account and USD budget

Settings links to **OCR account, limits and request history**. Use a dedicated OpenAI project key with Responses permission only, without administration, billing or unrelated API scopes. The owner declares sandbox or production project mode and confirms the employer agreements. Beam cannot independently verify project isolation or the provider's retention arrangements.

Each PDF needs a separate expiring approval with its immutable digest, model, per-document USD estimate and approved ceiling. A cumulative retained-request budget reserves the conservative estimate atomically before any provider request. Zero refuses all work. Two concurrent jobs cannot spend the same remaining budget. Successful, failed and unknown provider attempts retain their reservations across key rotation; a budget refusal records a visible failed job without a provider call or reservation. Increasing the budget is an explicit owner decision. A provider project spending limit is also recommended; Beam's estimate is not a provider invoice or absolute billing guarantee.

Rotation disables OCR and invalidates outstanding approvals. Account forms carry the reviewed configuration version; a stale tab or conflicting save is refused, preserving the newer key and budget decision. Reload and review the current settings before retrying. Revocation removes the held key. Installation exports withhold its ciphertext, and restores disable OCR until reauthorization. Existing accounts must be reauthorized after adopting the cumulative-budget migration. Credentials do not enter learning exports, proposals, audit details or configuration diagnostics. Only the provider receives the server-held key.

Owner-only aggregate health and the OCR consent/reservation defaults remain conservative defaults pending policy approval. Other provider families, real media-budget qualification and total account pricing remain partial under OPS-005/OPS-008.

## Backup limitation

Manual `rer export` and empty-installation `rer import` remain available. The pinned Base/rer release does not provide a supported scheduled encrypted archive sink or encryption-key custody/configuration door. OPS-004 remains blocked on that Base capability; no scheduled-backup, denied-storage recovery or global restore activation-fence guarantee is made.
