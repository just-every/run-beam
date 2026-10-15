# Beam demo

`rer demo` (the same as `rer dev --demo`) runs a throwaway copy of Beam,
signed in as the saved owner, with Harbour Physio's sample data. The nav and
page titles read **Beam Demo**; there is no injected bar or outbox.

```sh
rer demo          # prints RER_READY, RER_OPEN and RER_DEMO_ENDS_ON_STOP
rer demo --stop
```

Its data lives in `.rer/demo/<start time>/` and is deleted on stop, Ctrl-C or
expiry; this checkout's `.wrangler/state` is never written. The hosted demo at
https://demo.run-beam.com gives each visitor their own copy in their own
container for up to an hour (15 idle minutes), signed in through Base's signed
owner claim (`/auth/owner-claim`).

## Sample data

`src/demo.ts` writes it once, after the owner exists, with fixed ids and
dates relative to the start: Harbour Physio (Australia/Sydney), ten staff in
two teams (one whose access was removed), six owned procedures with licence
evidence, six courses (published, returned, in review and draft), two role
paths, and a few weeks of learning: lessons in progress, two overdue courses,
a learner out of quiz attempts, practical evidence waiting for its assessor, a
renewal coming due, offline sessions, certificates and a procedure change
waiting for review.

## Effects

Public reads run for real and sends to other people are simulated (Base's
`modules/demo`). In Beam:

| Path | Reaches | In a demo |
|---|---|---|
| Invitations, restored access, sign-in links and step-up mail (`operatorAuth` in `src/auth.server.ts`) | Staff mailboxes through Resend, SendGrid or Cloudflare | Mocked success through Base's `demoEffect`: the provider's accepted result, nothing sent |
| Identity provider discovery and keys (operator-auth OIDC) | The provider set in `IDENTITY_PROVIDER` | A real public read; demos configure no provider |

Beam has no other outbound path: no webhooks, payments, publishing or AI.

## Hosting

`deploy-demo.json` declares the host (`demo.run-beam.com`, `basic`
containers) and `.github/workflows/run-demo.yml` deploys it when run by hand
(or on push to main once `RUN_DEMO_DEPLOY` is `true`), reading the `run-demo`
environment. Run it by hand with `test_only` for the separate test host
`demo.test.run-beam.com`, and with `remove` to delete a demo. Base's
demo adoption guide (`DEMO.md` in Base's default seed) holds the full hosting
and removal contract.
