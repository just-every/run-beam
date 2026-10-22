# Learning data export

The owner opens **Settings → Data export → Download learning data**. This is
open-format interchange (OPS-002); use `rer export` for an installation backup.
The file is ordinary UTF-8 JSON and needs no Beam library to read. Keep it private.

`format` identifies `beam.learning-export.v1`. `exportedAt` is a UTC ISO timestamp.
`records` contains named tables, each with its complete `rows`, `count` and
`sha256`: SHA-256 of the UTF-8 bytes of `JSON.stringify(rows)` in the supplied
order. The records are read together in one database transaction. IDs retain
their stored values; fields ending in `_id` join those IDs. Embedded JSON fields
(such as draft content and assessment rules) remain JSON strings and can be
parsed independently. Integer timestamps are Unix milliseconds; calendar-day
strings and named IANA time zones retain their stored meaning. Null means absent.

The inventory covers the directory and teams; every course draft, published and
superseded revision, lesson, source version and assessment rule; paths and
requirements; assignments, progress and reset history; every quiz/practical
attempt, answer and assessor decision (including reset attempts); signature and
acknowledgment intent, signer, document digest, time and sign-in method; native
and external completions/certificates, certificate templates and corrections;
live attendance, native renewal rules and cycle-to-completion/assignment lineage, and labelled imported history. Imported history is separate
from native completions and creates no Beam certificate. SCORM package records
retain their immutable manifests, exact source-version citations, rights and
original ZIP identity. Revision links join packages to the exact course revision;
runtime runs join an assignment, package and SCO to stored state and total time.
Raw runtime events retain their run ID, event, payload and time. Playback sessions
and event `session_id` fields are withheld because they grant package asset access.
xAPI activity metadata and revision links retain the exact title, objectives,
activity IRI, launch URL and source-version citations. Launch records join the
activity, assignment and learner to their pseudonymous registration and outcome;
the launch ID and registration retain evidence context without authenticating a
request. Statement records retain the original JSON, its digest, launch lineage,
receipt and acceptance times, LRS storage time and any recorded failure. Original
JSON is preserved without adding an authority. These records are not an
authorization database and cannot sign anyone in.

`files` lists each source version and evidence attachment with its stable record
ID, original filename, media type, byte size, SHA-256 and `href`. Download each
href using the same signed-in owner session; bytes are verified against the
digest on every download. Duplicated bytes share a content-addressed href but
retain each referring record. `certificates` links each native certificate ID to
its downloadable PDF; certificate records/templates/corrections retain the exact
historical evidence independently of the PDF's current corrected display. Each
PDF and each decided signature evidence download (`signatures`) also has its
byte size and SHA-256; download and verify it before treating the export as complete.
xAPI attachments are employer-authorized evidence with no separate export
restriction. Their `files` entries retain the statement ID, filename, media type,
size and digest, and use the same authenticated owner download door.

The file inventory retains recorded source licence and licence evidence. Each
package's original ZIP and every extracted asset also retains its package ID,
filename (and asset path), media type, size, SHA-256, licence and licence evidence.
Unrestricted packages appear in `files`. An explicit package `export_restriction`
places its ZIP and every asset in `exclusions` instead, each with the recorded
`reason`, full file identity and an owner-only `retrievalHref`. No restriction is
inferred from licence prose. Exclusion from general interchange does not remove
the owner's authenticated retrieval right: those links still verify the stored
bytes and require the owner's current session, under the recorded licence
obligations. Package metadata, revision links, runs and raw events remain in
`records` even when bytes have an export restriction. Licensed-catalog and later
package/import capabilities must add their records and original assets here
before shipping, with any licence-limited file explicitly enumerated.

The format deliberately contains learning records, not auth sessions, provider
settings, model keys, application/preparation credentials or sharing tokens.
It also withholds xAPI LRS connection records, sealed producer credentials and
launch `auth_session_id` values. Statement JSON remains learning evidence rather
than connection configuration or an authentication grant.
Every manifest and file request checks the owner's current session. Revocation
ends downloads. A file changed or missing in storage fails visibly rather than
returning different bytes. An export is complete only after downloading its
listed files; compare their sizes and digests locally. This does not claim the
future package standards or licensed-content capabilities have shipped.
