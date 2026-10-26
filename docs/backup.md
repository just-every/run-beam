Beam exports durable learning records to an archive you keep and restores them into a fresh copy. Private tutor questions and answered caches are deliberately excluded.

## Export

Stop Beam first, then export:

```sh
rer dev --stop
rer export --output exports/beam.rer
```

The archive holds durable Beam records (your business, people and teams, sources and every version, courses and revisions, paths, assignments, progress, attempts, decisions, completions, certificates, imported history and the audit trail) and every stored file. It excludes tutor questions and answers, sign-in accounts, sessions, authentication secrets and private settings. Tutor source grants restore disabled and require a fresh owner grant; model and OCR connections require fresh provisioning and consent. Keep it somewhere safe: it contains your staff's names, email addresses and records.

Save archives in the `exports` folder or anywhere outside the Beam folder. Beam refuses to write one where it would be served to visitors.

## Restore

Restore into an empty copy of Beam, such as a fresh clone on a new computer:

```sh
npx -y @runeditrun/rer install just-every/run-beam --dir beam
cd beam
mkdir -p exports && cp /path/to/your/beam.rer exports/
rer import --input exports/beam.rer --yes
rer setup --owner-email you@example.com
rer dev
```

The import checks the archive and restores it all at once, or not at all; it refuses a copy that already holds data. `rer setup` makes you the owner of the restored copy, and `rer dev` opens it signed in. Finish setup again: the confirmation belongs to each installation, not the archive.

## Let your staff back in

Because archives carry no sign-in accounts, every restored staff member shows **Needs an invitation** on **People**. Press **Restore access** for each person: Beam sends them an ordinary invitation, and when they sign in their assignments, completions and certificates are all there.

## Start over

`rer reset --yes` removes all local data, the owner and the private settings from this copy. It cannot be undone: export first if you want the data back. Archives in the `exports` folder are kept.
