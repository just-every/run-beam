# Changelog

## 0.1.1 — 2026-11-26

Beam is training for your own procedures: a reviewer publishes an owned procedure as a course, staff complete the right revision, and managers can recover who completed what, when and on which evidence. It runs in your own Cloudflare account.

Prepare Beam for hosted installation with a digest-bound setup manifest, a deployment specification, dispatch-only Managed delivery and configurable hosted mail. Existing training records retain their existing project identity.

### What changed since 0.1.0

- **Owner sign-in and hosted setup.** The first owner claims Beam through a signed sign-in, and a hosted install reads one setup manifest and deployment specification.
- **Mail optional.** A Business can run Beam with mail off, or set Managed or direct-provider mail.
- **Frontline staff and portals.** Frontline sign-in methods, roster feed previews, themed enterprise portals with claims, learning, timed assessments, practical sign-off and quiz review.
- **Tutor and sources.** A consented tutor, source upload custody, and Microsoft Entra and Microsoft source connections.
- **Agent door.** Agents work through the company agent door with relay, replay custody and privacy rules, and every action an agent prepares still waits for a person.

### Upgrading

Migrations `0017_owner_signin` through `0127_business_retired` under `migrations/core` are added since 0.1.0 and listed in RELEASE.json; shipped migrations are unchanged. Preserve the existing project identity and applied migration bytes, and follow OPERATIONS.md for recovery.
