# Beam demo

`rer demo` (the same as `rer dev --demo`) runs a throwaway copy of Beam,
signed in as the saved owner, with Sierra Lakes Produce's sample data. The nav and
page titles read **Beam Demo**; there is no injected bar or outbox.

```sh
rer demo          # prints RER_READY, RER_OPEN and RER_DEMO_ENDS_ON_STOP
rer demo --stop
```

Its data lives in `.rer/demo/<start time>/` and is deleted on stop, Ctrl-C or
expiry; this checkout's `.wrangler/state` is never written. The hosted demo at
https://demo.run-beam.com gives each visitor their own copy in their own
native Worker isolate (its own SQLite database and R2 prefix) for up to an
hour (15 idle minutes), signed in through Base's signed owner claim
(`/auth/owner-claim`).

## Sample data

`src/demo.ts` writes it once, after the owner exists, with fixed ids and
dates relative to the start, from the records in `src/demo-records.ts`:
Sierra Lakes Produce (America/Los_Angeles), the employer the run site's
homepage follows. 131 people in three site teams (Fresno, CA 79; Joliet, IL 40;
Chicago, IL 12) plus one former employee whose access was removed; six owned
procedures with licence evidence; seven courses (published with earlier
superseded revisions, one revision in review and one draft); three role paths;
nine attested classroom sessions, which carry most of the crew's history; and
the followed staff: five overdue courses, a practical waiting for Maria Chen,
one waiting for the owner, a learner out of quiz attempts, a new hire whose
lift-truck course waits on its prerequisite, renewals expiring within 30 days,
the DP-7 procedure change and its revision waiting for review, and the
business agent's work (two plans waiting for a decision, one approved, one
declined). The owner, Colleen Shaw unless the demo names her, sees Manage
training with these records and, on My learning, her own course, a completion
with its certificate, a review and a practical to assess.

## Effects

Public reads run for real and sends to other people are simulated (Base's
`modules/demo`). In Beam:

| Path | Reaches | In a demo |
|---|---|---|
| Invitations, restored access, sign-in links and step-up mail (`operatorMail` in `src/mail.server.mjs`) | Staff mailboxes through Resend, SendGrid or Cloudflare | Mocked success: Base's development sender suppresses the message and the auth routes answer as sent |
| Identity provider discovery and keys (operator-auth OIDC) | The provider set in `IDENTITY_PROVIDER` | A real public read; demos configure no provider |

Beam has no other outbound path: no webhooks, payments, publishing or AI. The
agent work in the sample data is stored proposals; nothing calls a model.

## Hosting

`deploy-demo.json` declares the host (`demo.run-beam.com`) and `.github/workflows/run-demo.yml` deploys it when run by hand
(or on push to main once `RUN_DEMO_DEPLOY` is `true`), reading the `run-demo`
environment. Run it by hand with `test_only` for the separate test host
`demo.test.run-beam.com`, and with `remove` to delete a demo. Base's
demo adoption guide (`DEMO.md` in Base's default seed) holds the full hosting
and removal contract.

The hosted demo runs on Base's native Worker Loader host and signs in Colleen Shaw as
`colleen.shaw@sierra-lakes.example`. `deploy-demo.json` sets that owner address.
Invitations and sign-in links complete successfully through Base mail without sending.
