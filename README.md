<p><img src="public/brand/mark.svg" alt="Beam" width="40" height="47"></p>

# Run it locally

Beam is training for your own procedures: a reviewer publishes an owned
procedure as a course, staff complete the right revision, and managers can
recover who completed what, when and on which evidence. Working name;
first-release seed. Source code:
[just-every/run-beam](https://github.com/just-every/run-beam).
The site is at https://run-beam.com.

Start it from nothing in two lines, the same as https://run-beam.com/run: the
installer brings rer (and its own Node when there is none), then rer gets Beam,
installs everything, makes you the owner and opens it.

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
rer dev just-every/run-beam
```

Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-beam` does both steps in one line.

To start it again later, run `cd run-beam && rer dev`. To choose the owner mailbox yourself, run `npx -y @runeditrun/rer install just-every/run-beam`, then from the checkout:

```sh
rer setup --owner-email you@example.com
rer dev
```

`setup` builds the app, applies every local migration and claims the first
owner; it exits with nothing running. Use the setup prompt instead of `--owner-email` to enter
the real owner mailbox, or pass a private mode-0600 answers file inside the
checkout: `rer setup --answers exports/answers.json --non-interactive`
with `{"OWNER_EMAIL":"you@example.com"}`. No external email is sent; nothing
needs a provider account.

After `RER_READY`, `dev` prints `RER_SIGNED_IN` and `RER_OPEN URL`. Open that
URL on this computer: Beam opens signed in as the owner, confirms first-run at
`/setup`, then asks for the business name and time zone. Treat the line as a
credential. Try the other roles with dev personas, each a real local member:

```sh
rer dev --as learner    # Sam Lee, new staff
rer dev --as author     # Ana Ruiz, author and learner
rer dev --as reviewer   # Priya Shah, reviewer and learner
rer dev --as manager    # Tom Okafor, manager, assessor and learner
```

With `dev` already running, these print a fresh `RER_OPEN` for that persona and
exit. Local runs send no email: invitations and sign-in links answer as sent
and nothing leaves this computer. Stop `dev` with
`rer dev --stop` or Ctrl-C, and stop `preview` with
`rer preview --stop` before build or verification.

```sh
rer verify                                   # build, typecheck, email-link and flow proofs
rer reset --yes                              # removes local data, owner and settings
rer export --output exports/installation.rer # every Beam table and stored file
rer import --input exports/installation.rer --yes  # into an empty checkout only
rer deploy --dry-run                         # validates and builds; no provider request
rer describe                                 # the commands and flags this checkout supports
```

Reset is destructive: export first if you want the data back. Import needs an
empty destination and explicit confirmation; after it, run `setup` and sign in
again (sessions and credentials never travel in an archive). Real `deploy`
needs your own Cloudflare account and a verified mail sender. Pins: Node 22.20.0
and pnpm 10.12.4, selected automatically. `RUN-LOCALLY.md` and
`SEED-COMMAND-CONTRACT.md` hold the full command and state contract.

## What a person can do

- **Owner:** names the business and its time zone, invites adult staff with
  roles (author, reviewer, learner, manager, assessor) and teams, removes or
  restores access, and moves records in from TalentLMS.
- **Author:** uploads owned procedures and media with licence evidence and a
  responsible reviewer, builds courses (lessons citing exact source versions,
  a deterministic quiz, an optional practical assessment) and submits a revision.
- **Reviewer:** publishes or returns the revision, chooses whether open or
  completed learners move to it, and decides source-change notices and
  scheduled content reviews.
- **Manager:** builds role paths with prerequisites and renewal intervals,
  assigns courses and paths with due dates in an explicit time zone, works the
  overdue, retry and renewal queues, records attested offline training and reads
  any learner's record.
- **Learner:** resumes lessons on any device, takes quizzes, submits practical
  evidence and keeps certificates for completed revisions.
- **Assessor:** accepts or returns practical evidence sent to them by name.

Your own agent can prepare work through a scoped, expiring credential: course
drafts with the source passages they rely on, targeted assignment plans,
reminder drafts, question plans, process changes and practice scenarios.
Nothing reaches staff until a person approves it at **Agent work**, and every
decision is recorded. Staff answer question plans optionally and without their
names; practice scenarios are never scored. Optional course preparation and the
source-grounded tutor call the employer’s connected model account only after the
owner approves the exact disclosed request and its estimated USD reservation.

Every completion records the exact course and assessment revision and its
evidence. Beam's certificates are the business's own record of completion, not
an accreditation or a statement of competence.

## Moving in

The first move-in kit reads a TalentLMS course list (CSV) and course reports
(Excel: users overview and timeline). The preview writes nothing; apply is bound
to the reviewed preview; imported completions stay labelled as TalentLMS
history; undo keeps anything a manager reviewed after import. See
[CONTRACT.md](CONTRACT.md) (BEAM-15).

## Documents

[docs/](docs/site.json) — the owner guides (getting started, courses, assignments, learning, reports,
agent work, moving in, backup and restore), published with the run site. `rer build --site` writes the run site
(the landing page, the Run page and these docs) to `dist/site`. [CONTRACT.md](CONTRACT.md) — clauses and proofs. [ACCEPTANCE.md](ACCEPTANCE.md) —
the first-release outcome and what is still owed. [AGENTS.md](AGENTS.md) — how
to change Beam, including its JSON API for agents. [OPERATIONS.md](OPERATIONS.md)
— data custody and deployment. Licence: MIT ([LICENSE](LICENSE)); the fonts are
under the SIL Open Font License ([public/fonts](public/fonts/README.md)).
