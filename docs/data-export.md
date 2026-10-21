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
from native completions and creates no Beam certificate. These records are not
an authorization database and cannot sign anyone in.

`files` lists each source version and evidence attachment with its stable record
ID, original filename, media type, byte size, SHA-256 and `href`. Download each
href using the same signed-in owner session; bytes are verified against the
digest on every download. Duplicated bytes share a content-addressed href but
retain each referring record. `certificates` links each native certificate ID to
its downloadable PDF; certificate records/templates/corrections retain the exact
historical evidence independently of the PDF's current corrected display. Each
PDF and each decided signature evidence download (`signatures`) also has its
byte size and SHA-256; download and verify it before treating the export as complete.

The file inventory retains recorded source licence and licence evidence. Today
all stored sources are employer-uploaded with asserted rights and no separate
export restriction; `exclusions` is therefore empty. Package and licensed-catalog
capabilities do not exist yet. PACK-001–007, LIB-001–005 and MOVE-001–007 must add
their record kinds and original assets here before shipping; any licence-limited
file must appear in `exclusions` with its reason and authorized retrieval path.

The format deliberately contains learning records, not auth sessions, provider
settings, model keys, application/preparation credentials or sharing tokens.
Every manifest and file request checks the owner's current session. Revocation
ends downloads. A file changed or missing in storage fails visibly rather than
returning different bytes. An export is complete only after downloading its
listed files; compare their sizes and digests locally. This does not claim the
future package or licensed-content capabilities have shipped.
