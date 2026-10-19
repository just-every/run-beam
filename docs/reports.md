Beam keeps the record of who completed what, against which revision, with what evidence.

## The training report

Open **Reports**. Filter by **Course**, **Team** and **Status**, then press **Apply**:

| Status | Meaning |
| --- | --- |
| Open | Assigned and not yet complete. |
| Overdue | Assigned and past its due time. |
| Completed | Completed against the named revision, and current for more than 30 days. |
| Expiring | Completed, and the completion expires within 30 days. |
| Deferred | Assigned, with a deferral that still holds: not counted overdue until its end date. |
| Exempt | Assigned, with an exemption that still holds: the requirement is waived until its end date. |

Every record has exactly one status, the same as on **Manage**, so the line above the table adds up: records = completed + expiring + overdue + open + deferred + exempt. A deferral or exemption never moves the due date: the row keeps its due date, shows the original one before any due-date exception, and names the exception, its end date, its reason and who granted it, also after it ends.

Each row shows the learner, the course and revision, the due time in its time zone, lessons done, quiz attempts, the practical decision, the completion date with its certificate number, and when it expires.

**Download CSV** or **Download XLSX** gives you the same rows as a spreadsheet; every row (or the workbook's Definitions sheet) says when it was produced, the time zone and the filters, and nothing is left out.

## Saved dashboards

From **Reports**, open **Saved dashboards**. Owners, managers for their teams, learning administrators for their units and custom roles with report access can save a name, course/team/status filters and selected fields: name, course, due time, status and completion time. A dashboard is live data, not a snapshot: its as-of instant and saved filters appear on every view and CSV download. URL query changes do not change that saved selection. Dates in these selected fields are UTC.

The creator or owner adds a named viewer by work email. Viewers must already have their own current report authority; sharing grants no new access. Every opening and download uses the people both the creator and viewer can currently report on. A team outside either person's reach, ended grants or an empty common scope refuses access. Private answers, practice, evidence files and learner/evidence links are excluded.

A **restricted link** is for one named signed-in viewer, expires within 90 elapsed days and is shown only once. The form's expiry is UTC. Copy it when it appears; Beam stores only its hash and never puts the reusable link in Audit. A signed-out recipient signs in and then opens the original link again. **Revoke access** ends one share or link; **Revoke entire dashboard** ends them all immediately, including already-open sessions' next request. The owner can revoke a dashboard after its creator loses report authority. Restricted-link responses (including sign-in guidance and refusals), one-time URL output and CSV suppress the browser referrer. Ordinary management and named-view pages use same-origin; every mutation checks the exact application Origin.

## A learner's record

From **Manage**, open **Learner records** and choose a person: their assignments, completions with certificates, and history imported from a previous system, which is labeled as such and never counts as a Beam completion.

## Transcripts

On a person's record, open **Transcript** for everything that happened to their training, in time order: each assignment and its revision, every attempt (including those before a reset), assessor decisions, completions and certificates, offline attendance, due-date changes, access extensions, resets, cancellations and history imported from a previous system with where it came from. **Download CSV** and **Download XLSX** carry the same entries, with the time zone and the moment they were produced.

## What a completion means

A completion records what happened against an exact revision: the lessons, the quiz attempt that passed, the practical decision or the offline attestation. It is not a statement of competence.

## Audit

As the owner, open **Audit** to see every recorded decision and change, newest first (a learning administrator sees the events about their unit's people and courses, and an auditor the completions shared with them): who made it and when, whether it came through their own sign-in or an agent's preparation credential they delegated, the exact inputs, and for automatic outcomes (a timed quiz scored when its time ran out) the rule that applied. Search by words, **Category**, **Person** and a **From**/**To** day range (whole days in your time zone), and press **Download CSV** for the same events. Events are never edited or removed: use **Add a correction** to record an explanation beside one. Anonymous answers appear without the person or their words, and practice runs are not recorded.
