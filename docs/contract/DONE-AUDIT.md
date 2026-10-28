Old reference: `e1ab711cb9ad0fffc7b942dfb504770a30fa0cf1`.

| Clause | Point | Outcome | Asserting test | Result |
| --- | --- | --- | --- | --- |
| BEAM-01 | 1 | Through setup. | none | none |
| BEAM-01 | 1 | invitation. | none | none |
| BEAM-01 | 1 | people forms. | none | none |
| BEAM-01 | 1 | name the employer. | none | none |
| BEAM-01 | 1 | zone. | none | none |
| BEAM-01 | 1 | invite each role. | none | none |
| BEAM-01 | 1 | remove access during an active session. | none | none |
| BEAM-01 | 1 | restore it. | none | none |
| BEAM-01 | 1 | require a fresh sign-in. | none | none |
| BEAM-01 | 1 | try the same actions as a learner. | none | none |
| BEAM-02 | 1 | Upload a licensed procedure. | none | none |
| BEAM-02 | 1 | replacement version through Sources. | none | none |
| BEAM-02 | 1 | compare stored. | none | none |
| BEAM-02 | 1 | downloaded digests. | none | none |
| BEAM-02 | 1 | refuse unlicensed material. | none | none |
| BEAM-02 | 1 | and try to open an unassigned source as a learner. | none | none |
| BEAM-02 | 1 | uploaded script stays inert. | none | none |
| BEAM-03 | 1 | Edit. | none | none |
| BEAM-03 | 1 | submit a course through Courses. | none | none |
| BEAM-03 | 1 | refuse a stale save. | none | none |
| BEAM-03 | 1 | an unrelated reviewer. | none | none |
| BEAM-03 | 1 | publish by the named reviewer’s human form. | none | none |
| BEAM-03 | 1 | under the held company policy refuse agent JSON publication. | none | none |
| BEAM-03 | 1 | confirm later draft edits leave the published revision unchanged. | none | none |
| BEAM-04 | 1 | Save and revise a role path. | `tests/beam/flows.mjs:145` | asserted |
| BEAM-04 | 1 | Assign twice with no duplicates. | `tests/beam/flows.mjs:134`; `tests/beam/flows.mjs:135` | asserted |
| BEAM-04 | 1 | Before the prerequisite, the next course is blocked. | `tests/beam/flows.mjs:139`; `tests/beam/flows.mjs:141` | asserted |
| BEAM-04 | 1 | After prerequisite completion, the next course is startable. | none | none |
| BEAM-04 | 1 | The original assignment retains its path revision. | `tests/beam/flows.mjs:146` | asserted |
| BEAM-05 | 1 | An individual and team assignment keep one open assignment per learner and course. | `tests/beam/flows.mjs:154`; `tests/beam/flows.mjs:155` | asserted |
| BEAM-05 | 1 | Invalid calendar dates are refused. | `tests/beam/flows.mjs:151` | asserted |
| BEAM-05 | 1 | Invalid zones are refused. | `tests/beam/flows.mjs:152` | asserted |
| BEAM-05 | 1 | The precise IANA zone is retained. | `tests/beam/flows.mjs:157` | asserted |
| BEAM-05 | 1 | The exact due instant is retained. | `tests/beam/flows.mjs:158` | asserted |
| BEAM-05 | 1 | The assignment binds the precise published revision. | `tests/beam/flows.mjs:159` | asserted |
| BEAM-06 | 1 | A second signed-in session resumes at the next unread lesson. | `tests/beam/flows.mjs:170`; `tests/beam/flows.mjs:171` | asserted |
| BEAM-06 | 1 | The learning page links to the next unread lesson. | `tests/beam/flows.mjs:173` | asserted |
| BEAM-06 | 1 | Desktop-width resume behavior. | none | none |
| BEAM-06 | 1 | Phone-width resume behavior. | none | none |
| BEAM-07 | 1 | Partly correct and failing attempts fail. | `tests/beam/flows.mjs:186` | asserted |
| BEAM-07 | 1 | A correct attempt passes. | `tests/beam/flows.mjs:193` | asserted |
| BEAM-07 | 1 | Retries exhaust and prevent another attempt. | `tests/beam/flows.mjs:188`; `tests/beam/flows.mjs:189` | asserted |
| BEAM-07 | 1 | The manager grants another attempt. | none | none |
| BEAM-07 | 1 | The entered retry reason is read back. | none | none |
| BEAM-07 | 1 | Stored responses retain correctness. | `tests/beam/flows.mjs:196` | asserted |
| BEAM-07 | 1 | The exact-choice scoring rule is stored. | `tests/beam/flows.mjs:195` | asserted |
| BEAM-08 | 1 | Submit text. | none | none |
| BEAM-08 | 1 | a file through Practical evidence. | none | none |
| BEAM-08 | 1 | try an unrelated assessor. | none | none |
| BEAM-08 | 1 | revoke the named assessor’s role in an existing session. | none | none |
| BEAM-08 | 1 | restore. | none | none |
| BEAM-08 | 1 | decide. | none | none |
| BEAM-08 | 1 | completion waits for the authorized decision. | none | none |
| BEAM-09 | 1 | Premature practical and quiz completion are refused. | `tests/beam/flows.mjs:227`; `tests/beam/flows.mjs:228` | asserted |
| BEAM-09 | 1 | Incomplete required work records no completion. | `tests/beam/flows.mjs:229` | asserted |
| BEAM-09 | 1 | Required learning and assessments complete the assignment. | `tests/beam/flows.mjs:215` | asserted |
| BEAM-09 | 1 | Completion binds the exact course revision. | `tests/beam/flows.mjs:216` | asserted |
| BEAM-09 | 1 | Completion binds the exact assessment revision. | `tests/beam/flows.mjs:218` | asserted |
| BEAM-09 | 1 | Completion keeps the quiz and practical evidence ids. | `tests/beam/flows.mjs:222` | asserted |
| BEAM-09 | 1 | Publishing and reassignment preserve the earlier completion revision. | `tests/beam/flows.mjs:244` | asserted |
| BEAM-10 | 1 | Record attendance through Manage for current. | none | none |
| BEAM-10 | 1 | historical published revisions. | none | none |
| BEAM-10 | 1 | reject future dates. | none | none |
| BEAM-10 | 1 | verify only a matching revision’s assignment closes while the other remains open. | none | none |
| BEAM-11 | 1 | A certificate has its number. | `tests/beam/flows.mjs:270` | asserted |
| BEAM-11 | 1 | The certificate names the employer issuer. | `tests/beam/flows.mjs:269` | asserted |
| BEAM-11 | 1 | The certificate binds the exact revision. | `tests/beam/flows.mjs:269` | asserted |
| BEAM-11 | 1 | The completion date is read back. | none | none |
| BEAM-11 | 1 | Expiry is read back. | `tests/beam/flows.mjs:269`; `tests/beam/flows.mjs:272` | asserted |
| BEAM-11 | 1 | The learner and manager can open the certificate. | `tests/beam/flows.mjs:275` | asserted |
| BEAM-11 | 1 | The non-accreditation statement is asserted. | none | none |
| BEAM-12 | 1 | Open learner reminders. | none | none |
| BEAM-12 | 1 | each role’s queue with due. | none | none |
| BEAM-12 | 1 | overdue. | none | none |
| BEAM-12 | 1 | retry. | none | none |
| BEAM-12 | 1 | source-change. | none | none |
| BEAM-12 | 1 | practical. | none | none |
| BEAM-12 | 1 | renewal work. | none | none |
| BEAM-12 | 1 | repeat a renewal after a path change. | none | none |
| BEAM-12 | 1 | verify no duplicate or lost original renewal policy. | none | none |
| BEAM-13 | 1 | Request a second learner’s assignments. | none | none |
| BEAM-13 | 1 | attempts. | none | none |
| BEAM-13 | 1 | files. | none | none |
| BEAM-13 | 1 | records. | none | none |
| BEAM-13 | 1 | certificates through pages. | none | none |
| BEAM-13 | 1 | downloads. | none | none |
| BEAM-13 | 1 | JSON. | none | none |
| BEAM-13 | 1 | sign out. | none | none |
| BEAM-13 | 1 | send a cross-origin write. | none | none |
| BEAM-13 | 1 | each is refused without disclosure. | none | none |
| BEAM-14 | 1 | change a source. | none | none |
| BEAM-14 | 1 | inspect the reviewer’s affected-course notice. | none | none |
| BEAM-14 | 1 | submit a passage-cited preparation proposal. | none | none |
| BEAM-14 | 1 | reject an outdated draft proposal. | none | none |
| BEAM-14 | 1 | revoke its delegated session. | none | none |
| BEAM-14 | 1 | refuse agent publication or decision. | none | none |
| BEAM-14 | Requirement | Company-policy computation for the declared classes. | none | none |
| BEAM-15 | 1 | Preview a TalentLMS course-list CSV. | none | none |
| BEAM-15 | 1 | users-overview. | none | none |
| BEAM-15 | 1 | timeline workbooks in Import. | none | none |
| BEAM-15 | 1 | verify no writes. | none | none |
| BEAM-15 | 1 | resolve gaps. | none | none |
| BEAM-15 | 1 | apply the fingerprint. | none | none |
| BEAM-15 | 1 | repeat without duplicates. | none | none |
| BEAM-15 | 1 | undo while preserving subsequently reviewed rows. | none | none |
| BEAM-15 | 2 | The Move in screen. | none | none |
| BEAM-15 | 2 | Business grants share retained upload. | none | none |
| BEAM-15 | 2 | plan. | none | none |
| BEAM-15 | 2 | fingerprint review. | none | none |
| BEAM-15 | 2 | apply. | none | none |
| BEAM-15 | 2 | reconcile. | none | none |
| BEAM-15 | 2 | undo. | none | none |
| BEAM-15 | 3 | Self-hosted Business imports default off. | none | none |
| BEAM-15 | 3 | RER's server-owned provisioning approval enables them after the first owner claim. | none | none |
| BEAM-15 | 3 | later owner paths heal a missed enable without overriding a disabled door. | none | none |
| BEAM-15 | 4 | Durable key revocation survives re-enabling. | none | none |
| BEAM-15 | 5 | Owner history. | none | none |
| BEAM-15 | 5 | undo include prior imports. | none | none |
| BEAM-15 | 6 | Only Move in permits a same-origin static upload script. | none | none |
| BEAM-15 | 6 | same-origin chunk connections. | none | none |
| BEAM-15 | 6 | no inline. | none | none |
| BEAM-15 | 6 | eval or external scripts. | none | none |
| BEAM-15 | 6 | destinations are admitted. | none | none |
| BEAM-16 | 1 | Use rer export. | none | none |
| BEAM-16 | 1 | restore into an empty fresh installation. | none | none |
| BEAM-16 | 1 | sign in anew. | none | none |
| BEAM-16 | 1 | read records. | none | none |
| BEAM-16 | 1 | files. | none | none |
| BEAM-16 | 1 | certificates. | none | none |
| BEAM-16 | 1 | reject corruption. | none | none |
| BEAM-16 | 1 | a populated target. | none | none |
| BEAM-16 | 1 | an archive placed under public assets. | none | none |
| BEAM-16 | 1 | compare the next export. | none | none |
| BEAM-17 | 1 | Course filtering restricts rows. | `tests/beam/agent-flows.mjs:31` | asserted |
| BEAM-17 | 1 | Team filtering restricts rows. | `tests/beam/agent-flows.mjs:46` | asserted |
| BEAM-17 | 1 | State filtering reconciles rows. | `tests/beam/agent-flows.mjs:38`; `tests/beam/agent-flows.mjs:39` | asserted |
| BEAM-17 | 1 | Offline completions appear. | `tests/beam/agent-flows.mjs:34` | asserted |
| BEAM-17 | 1 | CSV row counts equal report row counts. | `tests/beam/agent-flows.mjs:53` | asserted |
| BEAM-17 | 1 | CSV retains certificate and revision. | `tests/beam/agent-flows.mjs:54` | asserted |
| BEAM-17 | 1 | Formula-like report fields stay inert. | none | none |
| BEAM-17 | 1 | Learner report reads are refused. | `tests/beam/agent-flows.mjs:23`; `tests/beam/agent-flows.mjs:24` | asserted |
| BEAM-18 | 1 | issue a real preparation credential. | none | none |
| BEAM-18 | 1 | propose assignments. | none | none |
| BEAM-18 | 1 | reminders through the API. | none | none |
| BEAM-18 | 1 | inspect reasons. | none | none |
| BEAM-18 | 1 | exclusions. | none | none |
| BEAM-18 | 1 | payload digest in Agent work. | none | none |
| BEAM-18 | 1 | reject unauthorized or stale approvals. | none | none |
| BEAM-18 | 1 | approve exact work as a manager. | none | none |
| BEAM-18 | Requirement | Company-policy computation for the declared classes. | none | none |
| BEAM-19 | 1 | An invited person can answer once and a repeat is refused. | `tests/beam/agent-flows.mjs:134` | asserted |
| BEAM-19 | 1 | A decline is counted without answer disclosure. | `tests/beam/agent-flows.mjs:139` | asserted |
| BEAM-19 | 1 | Open plans withhold answers. | `tests/beam/agent-flows.mjs:139` | asserted |
| BEAM-19 | 1 | Closed plans below the minimum withhold answers. | `tests/beam/agent-flows.mjs:143` | asserted |
| BEAM-19 | 1 | Closed plans above the minimum release the three answers. | `tests/beam/agent-flows.mjs:152` | asserted |
| BEAM-19 | 1 | Released answers contain no person identity. | `tests/beam/agent-flows.mjs:153` | asserted |
| BEAM-19 | 1 | The recommendation is separately recorded. | `tests/beam/agent-flows.mjs:157`; `tests/beam/agent-flows.mjs:158` | asserted |
| BEAM-19 | 1 | The company-policy class controls the agent call. | none | none |
| BEAM-20 | 1 | Invalid graphs and uncited sources are refused. | `tests/beam/agent-flows.mjs:171`; `tests/beam/agent-flows.mjs:172` | asserted |
| BEAM-20 | 1 | Unrelated authors and managers cannot deploy. | `tests/beam/agent-flows.mjs:175`; `tests/beam/agent-flows.mjs:176` | asserted |
| BEAM-20 | 1 | The assigned learner reaches the scenario. | `tests/beam/agent-flows.mjs:180` | asserted |
| BEAM-20 | 1 | A choice shows its feedback. | `tests/beam/agent-flows.mjs:186` | asserted |
| BEAM-20 | 1 | A finished scenario restarts from its first step. | `tests/beam/agent-flows.mjs:190`; `tests/beam/agent-flows.mjs:193` | asserted |
| BEAM-20 | 1 | Practice creates no quiz attempt. | `tests/beam/agent-flows.mjs:201` | asserted |
| BEAM-20 | 1 | Practice creates no completion. | `tests/beam/agent-flows.mjs:200` | asserted |
| BEAM-20 | 1 | Practice creates no certificate. | none | none |
| BEAM-20 | 1 | Another person cannot read the private run. | `tests/beam/agent-flows.mjs:203` | asserted |
| BEAM-20 | 1 | The company-policy class controls deployment. | none | none |
| ORG-001 | 1 | Import a US roster and retain the resulting people. | `tests/beam/regression-directory.mjs:23` | asserted |
| ORG-001 | 1 | The email-less person retains the employee id. | `tests/beam/regression-directory.mjs:27` | asserted |
| ORG-001 | 1 | The email-less person retains the mobile number. | `tests/beam/regression-directory.mjs:30` | asserted |
| ORG-001 | 1 | Changing work email preserves the signed-in identity. | `tests/beam/regression-directory.mjs:50`; `tests/beam/regression-directory.mjs:51` | asserted |
| ORG-001 | 1 | Changing email preserves learning assignments. | `tests/beam/regression-directory.mjs:52` | asserted |
| ORG-001 | 1 | Rehire keeps the same employee without creating another. | `tests/beam/regression-directory.mjs:58` | asserted |
| ORG-001 | 1 | Rehire preserves learning history. | `tests/beam/regression-directory.mjs:59` | asserted |
| ORG-001 | 1 | Conflicting external identities wait for explicit resolution. | `tests/beam/regression-directory.mjs:68`; `tests/beam/regression-directory.mjs:69`; `tests/beam/regression-directory.mjs:76` | asserted |
| ORG-001 | 1 | Directory history retains email and rehire events. | `tests/beam/regression-directory.mjs:80` | asserted |
| ORG-002 | 1 | Grant a learning administrator one unit. | none | none |
| ORG-002 | 1 | manage its courses. | none | none |
| ORG-002 | 1 | learners. | none | none |
| ORG-002 | 1 | request another unit. | none | none |
| ORG-002 | 1 | provider credentials through HTML. | none | none |
| ORG-002 | 1 | JSON. | none | none |
| ORG-002 | 1 | deny both. | none | none |
| ORG-002 | 1 | revoke the active grant. | none | none |
| ORG-002 | 2 | As that administrator. | none | none |
| ORG-002 | 2 | invite a learner into the unit's team. | none | none |
| ORG-002 | 2 | set its members. | none | none |
| ORG-002 | 2 | set. | none | none |
| ORG-002 | 2 | extend the window of their own enrollment. | none | none |
| ORG-002 | 2 | and be refused another unit's team. | none | none |
| ORG-002 | 2 | another role. | none | none |
| ORG-002 | 2 | an outside person. | none | none |
| ORG-002 | 2 | naming a manager. | none | none |
| ORG-002 | 2 | another person's enrollment window. | none | none |
| ORG-003 | 1 | Give an expert one course. | none | none |
| ORG-003 | 1 | coauthor. | none | none |
| ORG-003 | 1 | review it. | none | none |
| ORG-003 | 1 | try an unrelated course. | none | none |
| ORG-003 | 1 | people administration. | none | none |
| ORG-003 | 1 | evidence download. | none | none |
| ORG-003 | 1 | replace its reviewer. | none | none |
| ORG-003 | 1 | retain both decision histories. | none | none |
| ORG-003 | 1 | with self-review allowed. | none | none |
| ORG-003 | 1 | have one learning administrator author. | none | none |
| ORG-003 | 1 | publish a fix. | none | none |
| ORG-003 | 1 | find it labeled self-reviewed in history. | none | none |
| ORG-003 | 1 | refuse the same when self-review is off. | none | none |
| ORG-004 | 1 | Each manager assigns within their own team. | `tests/beam/regression-managers.mjs:31` | asserted |
| ORG-004 | 1 | Each manager reports within their own team. | `tests/beam/regression-managers.mjs:31`; `tests/beam/regression-managers.mjs:34` | asserted |
| ORG-004 | 1 | Cross-team assignments and reports are refused. | `tests/beam/regression-managers.mjs:23`; `tests/beam/regression-managers.mjs:26`; `tests/beam/regression-managers.mjs:32` | asserted |
| ORG-004 | 1 | A manager without the named assessor grant cannot decide practical evidence. | `tests/beam/regression-managers.mjs:56` | asserted |
| ORG-004 | 1 | Temporary coverage gives access to the covered team. | `tests/beam/regression-managers.mjs:74` | asserted |
| ORG-004 | 1 | Expired coverage removes that access. | `tests/beam/regression-managers.mjs:76`; `tests/beam/regression-managers.mjs:77`; `tests/beam/regression-managers.mjs:80` | asserted |
| ORG-005 | 1 | Invite an instructor. | none | none |
| ORG-005 | 1 | a time-limited auditor through Access. | none | none |
| ORG-005 | 1 | conduct a session. | none | none |
| ORG-005 | 1 | download the allowed evidence. | none | none |
| ORG-005 | 1 | try prohibited writes. | none | none |
| ORG-005 | 1 | access after expiry. | none | none |
| ORG-005 | 2 | As an instructor-only person. | none | none |
| ORG-005 | 2 | try team. | none | none |
| ORG-005 | 2 | course announcements. | none | none |
| ORG-005 | 2 | receive 403. | none | none |
| ORG-005 | 2 | after instructor access expires. | none | none |
| ORG-005 | 2 | announcing. | none | none |
| ORG-005 | 2 | new replies are refused. | none | none |
| ORG-006 | 1 | The 200-person roster preview names the duplicate emails. | `tests/beam/regression-roster.mjs:43` | asserted |
| ORG-006 | 1 | The roster names the invalid manager. | `tests/beam/regression-roster.mjs:43` | asserted |
| ORG-006 | 1 | The transfer is previewed. | `tests/beam/regression-roster.mjs:41` | asserted |
| ORG-006 | 1 | Email-less rows preserve usernames and mobile numbers. | `tests/beam/regression-roster.mjs:44`; `tests/beam/regression-roster.mjs:72` | asserted |
| ORG-006 | 1 | The preview writes no people or mail. | `tests/beam/regression-roster.mjs:47` | asserted |
| ORG-006 | 1 | Interrupted apply resumes through the form. | `tests/beam/regression-roster.mjs:56`; `tests/beam/regression-roster.mjs:61`; `tests/beam/regression-roster.mjs:67` | asserted |
| ORG-006 | 1 | Invitations are not repeated. | `tests/beam/regression-roster.mjs:65` | asserted |
| ORG-006 | 1 | Applying twice changes no people or mail. | `tests/beam/regression-roster.mjs:76`; `tests/beam/regression-roster.mjs:80` | asserted |
| ORG-007 | 1 | As a learner find a course. | none | none |
| ORG-007 | 1 | self-enroll in an open course. | none | none |
| ORG-007 | 1 | request a restricted one. | none | none |
| ORG-007 | 1 | withdraw. | none | none |
| ORG-007 | 1 | inspect history. | none | none |
| ORG-007 | 1 | unauthorized courses. | none | none |
| ORG-007 | 1 | other learners’ favorites stay hidden. | none | none |
| ORG-010 | 1 | Create a “Site training coordinator” role with enrollment. | none | none |
| ORG-010 | 1 | reports for one location. | none | none |
| ORG-010 | 1 | grant it. | none | none |
| ORG-010 | 1 | enroll. | none | none |
| ORG-010 | 1 | report in that location. | none | none |
| ORG-010 | 2 | Try another location. | none | none |
| ORG-010 | 2 | a provider credential. | none | none |
| ORG-010 | 2 | a publication. | none | none |
| ORG-010 | 2 | and see each refused. | none | none |
| ORG-010 | 3 | Remove the reports permission. | none | none |
| ORG-010 | 3 | see the open session lose report access. | none | none |
| ORG-012 | 1 | As a learning administrator. | none | none |
| ORG-012 | 1 | open “View as” for a learner in your unit. | none | none |
| ORG-012 | 1 | see their assignments. | none | none |
| ORG-012 | 1 | progress. | none | none |
| ORG-012 | 1 | quiz results. | none | none |
| ORG-012 | 1 | certificates as they see them. | none | none |
| ORG-012 | 1 | try to answer a quiz. | none | none |
| ORG-012 | 1 | mark a lesson read. | none | none |
| ORG-012 | 1 | change their language. | none | none |
| ORG-012 | 1 | see each refused. | none | none |
| ORG-012 | 2 | Find the session in Audit. | none | none |
| ORG-012 | 3 | Try “View as” for a learner in another unit. | none | none |
| ORG-012 | 3 | for the owner. | none | none |
| ORG-012 | 3 | for another administrator. | none | none |
| ORG-012 | 3 | see each refused. | none | none |
| ORG-012 | 3 | confirm the learner’s practice runs. | none | none |
| ORG-012 | 3 | anonymous answers are not shown. | none | none |
| AUTHOR-001 | 1 | Create. | none | none |
| AUTHOR-001 | 1 | preview a mixed-media course through the editor. | none | none |
| AUTHOR-001 | 1 | reuse a block. | none | none |
| AUTHOR-001 | 1 | rearrange it. | none | none |
| AUTHOR-001 | 1 | publish. | none | none |
| AUTHOR-001 | 1 | embed a YouTube video. | none | none |
| AUTHOR-001 | 1 | a Loom recording. | none | none |
| AUTHOR-001 | 1 | a Google Slides deck. | none | none |
| AUTHOR-001 | 1 | play each as a learner. | none | none |
| AUTHOR-001 | 1 | try active HTML. | none | none |
| AUTHOR-001 | 1 | an unlisted embed host. | none | none |
| AUTHOR-001 | 1 | confirm the lesson. | none | none |
| AUTHOR-001 | 1 | assets render safely. | none | none |
| AUTHOR-003 | 1 | Have two authors edit the same lesson. | none | none |
| AUTHOR-003 | 1 | resolve the conflict. | none | none |
| AUTHOR-003 | 1 | leave. | none | none |
| AUTHOR-003 | 1 | resolve a question comment. | none | none |
| AUTHOR-003 | 1 | submit learner feedback. | none | none |
| AUTHOR-003 | 1 | show it in the owner’s content queue. | none | none |
| AUTHOR-004 | 1 | Publish two revisions. | none | none |
| AUTHOR-004 | 1 | compare them. | none | none |
| AUTHOR-004 | 1 | restore the first into a new draft through course history. | none | none |
| AUTHOR-004 | 1 | publish that draft. | none | none |
| AUTHOR-004 | 1 | verify all three revisions. | none | none |
| AUTHOR-004 | 1 | prior completion evidence. | none | none |
| AUTHOR-005 | 1 | Build courses from a template. | none | none |
| AUTHOR-005 | 1 | clone. | none | none |
| AUTHOR-005 | 1 | bulk tag them. | none | none |
| AUTHOR-005 | 1 | retire one with an open assignment. | none | none |
| AUTHOR-005 | 1 | verify retained evidence plus refusal of new enrollment. | none | none |
| AUTHOR-006 | 1 | Set a review date. | none | none |
| AUTHOR-006 | 1 | advance the scheduler with no source change. | none | none |
| AUTHOR-006 | 1 | remove the owner. | none | none |
| AUTHOR-006 | 1 | inspect fallback escalation. | none | none |
| AUTHOR-006 | 1 | separately replace a cited source. | none | none |
| AUTHOR-006 | 1 | record a no-change decision. | none | none |
| AUTHOR-010 | 1 | With one learner mid-course. | none | none |
| AUTHOR-010 | 1 | one finished. | none | none |
| AUTHOR-010 | 1 | publish a typo fix. | none | none |
| AUTHOR-010 | 1 | choose “move”: the mid-course learner keeps their progress at the same place. | none | none |
| AUTHOR-010 | 2 | Then publish a revision with an added lesson. | none | none |
| AUTHOR-010 | 2 | marked material. | none | none |
| AUTHOR-010 | 2 | choosing “move”. | none | none |
| AUTHOR-010 | 2 | “reassign finished”: the mid-course learner sees only the new lesson reopened. | none | none |
| AUTHOR-010 | 2 | the finished learner’s original completion. | none | none |
| AUTHOR-010 | 2 | certificate are unchanged. | none | none |
| AUTHOR-010 | 2 | and a new assignment appears for them. | none | none |
| AUTHOR-010 | 3 | Repeat the publication with “keep”. | none | none |
| AUTHOR-010 | 3 | see no assignment move or new assignment. | none | none |
| PACK-001 | 1 | upload a real licensed SCORM 1.2 package through Courses. | none | none |
| PACK-001 | 1 | preview. | none | none |
| PACK-001 | 1 | assign it. | none | none |
| PACK-001 | 1 | suspend on one device. | none | none |
| PACK-001 | 1 | resume on another. | none | none |
| PACK-001 | 1 | fail. | none | none |
| PACK-001 | 1 | pass. | none | none |
| PACK-001 | 1 | inspect raw runtime events. | none | none |
| PACK-001 | 1 | the exact completion revision. | none | none |
| PACK-001 | 1 | change a procedure the package cites. | none | none |
| PACK-001 | 1 | see its metadata listed in the AGENT-004 impact. | none | none |
| PACK-001 | Requirement | Company-policy computation for the declared classes. | none | none |
| PACK-002 | 1 | Import licensed packages from each edition. | none | none |
| PACK-002 | 1 | exercise a multi-SCO prerequisite sequence. | none | none |
| PACK-002 | 1 | suspend. | none | none |
| PACK-002 | 1 | resume. | none | none |
| PACK-002 | 1 | inspect failed. | none | none |
| PACK-002 | 1 | completed. | none | none |
| PACK-002 | 1 | passed outcomes. | none | none |
| PACK-002 | 1 | a refused invalid manifest. | none | none |
| PACK-006 | 1 | Register an LTI sandbox. | none | none |
| PACK-006 | 1 | deep-link a lesson. | none | none |
| PACK-006 | 1 | receive a grade. | none | none |
| PACK-006 | 1 | rotate keys. | none | none |
| PACK-006 | 1 | revoke deployment. | none | none |
| PACK-006 | 1 | replay a foreign result through the callback door. | none | none |
| PACK-006 | Requirement | Company-policy computation for the declared classes. | none | none |
| LIB-006 | 1 | Define a food-handler requirement for kitchen staff with a 30-day reminder. | none | none |
| LIB-006 | 2 | As a learner on a phone. | none | none |
| LIB-006 | 2 | photograph. | none | none |
| LIB-006 | 2 | upload a food-handler card with its expiry date. | none | none |
| LIB-006 | 2 | see it pending. | none | none |
| LIB-006 | 2 | approve it as the manager. | none | none |
| LIB-006 | 2 | see REPORT-001 count the learner current. | none | none |
| LIB-006 | 2 | labeled external. | none | none |
| LIB-006 | 3 | Reject a second upload with a reason. | none | none |
| LIB-006 | 3 | see the learner told why. | none | none |
| LIB-006 | 4 | Advance time to 30 days before expiry. | none | none |
| LIB-006 | 4 | see the reminder to the learner. | none | none |
| LIB-006 | 4 | manager. | none | none |
| LIB-006 | 4 | let it lapse. | none | none |
| LIB-006 | 4 | see the learner missing with the old certificate still in their transcript. | none | none |
| LIB-006 | 4 | export. | none | none |
| LEARN-001 | 1 | Publish a course using a randomized bank. | none | none |
| LEARN-001 | 1 | free response. | none | none |
| LEARN-001 | 1 | survey. | none | none |
| LEARN-001 | 1 | take two attempts. | none | none |
| LEARN-001 | 1 | grade the written task as the assigned assessor. | none | none |
| LEARN-001 | 1 | inspect reproducible scoring. | none | none |
| LEARN-001 | 1 | absence of survey-based completion. | none | none |
| LEARN-002 | 1 | Create a template. | none | none |
| LEARN-002 | 1 | complete a course. | none | none |
| LEARN-002 | 1 | download the PDF. | none | none |
| LEARN-002 | 1 | verify only permitted fields as a visitor. | none | none |
| LEARN-002 | 1 | revoke its link. | none | none |
| LEARN-002 | 1 | issue a corrected certificate with retained lineage. | none | none |
| LEARN-003 | 1 | At 390. | none | none |
| LEARN-003 | 1 | 1440 pixels complete an assigned mixed-media. | none | none |
| LEARN-003 | 1 | package course. | none | none |
| LEARN-003 | 1 | upload practical evidence. | none | none |
| LEARN-003 | 1 | interrupt connectivity. | none | none |
| LEARN-003 | 1 | resume. | none | none |
| LEARN-003 | 1 | inspect saved versus pending state. | none | none |
| LEARN-003 | 1 | accessible controls. | none | none |
| LEARN-007 | 1 | Map a role’s objectives. | none | none |
| LEARN-007 | 1 | record a learner’s goal. | none | none |
| LEARN-007 | 1 | diagnostic gap. | none | none |
| LEARN-007 | 1 | inspect recommended courses. | none | none |
| LEARN-007 | 1 | approve a minimal path. | none | none |
| LEARN-007 | 1 | opt out of optional personalization. | none | none |
| LEARN-007 | 1 | verify required learning remains. | none | none |
| LEARN-008 | 1 | Ask an answerable. | none | none |
| LEARN-008 | 1 | unsupported policy question from the learner page. | none | none |
| LEARN-008 | 1 | follow citations. | none | none |
| LEARN-008 | 1 | revoke a source grant. | none | none |
| LEARN-008 | 1 | try prompt injection in a document. | none | none |
| LEARN-008 | 1 | verify no restricted passage or fabricated answer is shown. | none | none |
| LEARN-008 | 2 | Only the authorized source grant for the named course cohort permits retrieval. | none | none |
| LEARN-008 | 2 | enrollment. | none | none |
| LEARN-008 | 2 | revision access. | none | none |
| LEARN-008 | 2 | source visibility. | none | none |
| LEARN-008 | 2 | erasure restrictions. | none | none |
| LEARN-008 | 2 | recorded content rights all continue to hold. | none | none |
| LEARN-008 | 3 | Before the question is submitted. | none | none |
| LEARN-008 | 3 | disclose the question. | none | none |
| LEARN-008 | 3 | learning purpose. | none | none |
| LEARN-008 | 3 | permitted passages. | none | none |
| LEARN-008 | 3 | paid provider. | none | none |
| LEARN-008 | 3 | consent covers this question. | none | none |
| LEARN-008 | 3 | purpose only. | none | none |
| LEARN-008 | 4 | Exclude learner records. | none | none |
| LEARN-008 | 4 | assessment answers. | none | none |
| LEARN-008 | 4 | evidence. | none | none |
| LEARN-008 | 4 | anonymous diagnostic answers. | none | none |
| LEARN-008 | 4 | private practice from model context. | none | none |
| LEARN-008 | 4 | disclose any learner-supplied information in the question itself. | none | none |
| LEARN-008 | 5 | Expert handoff requires a separate learner action identifying the question text. | none | none |
| LEARN-008 | 5 | named cohort discussion audience. | none | none |
| LEARN-008 | 5 | model consent never authorizes posting. | none | none |
| LEARN-008 | Requirement | Company-policy computation for the declared classes. | none | none |
| LEARN-010 | 1 | Assign a policy acknowledgment. | none | none |
| LEARN-010 | 1 | sign after viewing it. | none | none |
| LEARN-010 | 1 | decline another. | none | none |
| LEARN-010 | 1 | publish a revised policy. | none | none |
| LEARN-010 | 1 | download original signed evidence. | none | none |
| LEARN-010 | 1 | see a separate new acknowledgment requirement. | none | none |
| LEARN-013 | 1 | Configure a badge. | none | none |
| LEARN-013 | 1 | levels. | none | none |
| LEARN-013 | 1 | an activity leaderboard. | none | none |
| LEARN-013 | 1 | an optional team challenge. | none | none |
| LEARN-013 | 1 | earn the badge. | none | none |
| LEARN-013 | 1 | a level through a real completion. | none | none |
| LEARN-013 | 1 | see the leaderboard’s activity label. | none | none |
| LEARN-013 | 1 | opt out of public recognition. | none | none |
| LEARN-013 | 1 | disappear from the leaderboard. | none | none |
| LEARN-013 | 1 | verify attempts. | none | none |
| LEARN-013 | 1 | completion policy. | none | none |
| LEARN-013 | 1 | private practice are unchanged. | none | none |
| LEARN-014 | 1 | Ask a lesson question as an enrolled learner. | none | none |
| LEARN-014 | 1 | have its expert answer. | none | none |
| LEARN-014 | 1 | propose a draft update. | none | none |
| LEARN-014 | 1 | moderate an unsafe attachment. | none | none |
| LEARN-014 | 1 | try access from another cohort. | none | none |
| LEARN-014 | 1 | preserve separate assessment evidence. | none | none |
| LEARN-015 | 1 | Publish a test with one question of each type. | none | none |
| LEARN-015 | 1 | take it with all-correct. | none | none |
| LEARN-015 | 1 | one-wrong. | none | none |
| LEARN-015 | 1 | accepted-variant answers through the learner page at 390. | none | none |
| LEARN-015 | 1 | 1440 pixels. | none | none |
| LEARN-015 | 1 | by keyboard. | none | none |
| LEARN-015 | 1 | and inspect each attempt’s stored responses. | none | none |
| LEARN-015 | 1 | rule. | none | none |
| LEARN-015 | 1 | score. | none | none |
| LEARN-016 | 1 | Upload a GIFT file with every GIFT question type. | none | none |
| LEARN-016 | 1 | an Aiken file. | none | none |
| LEARN-016 | 1 | inspect the preview. | none | none |
| LEARN-016 | 1 | its named losses. | none | none |
| LEARN-016 | 1 | apply them. | none | none |
| LEARN-016 | 1 | publish a test drawing from the bank. | none | none |
| LEARN-016 | 1 | take it with each type scored correctly. | none | none |
| LEARN-016 | 1 | export the bank. | none | none |
| LEARN-016 | 1 | re-import it without duplicates. | none | none |
| LEARN-018 | 1 | Publish a scored quiz with a 10-minute limit. | none | none |
| LEARN-018 | 1 | a practical with no clock. | none | none |
| LEARN-018 | 1 | start the quiz as a learner. | none | none |
| LEARN-018 | 1 | see the accessible countdown from the server deadline. | none | none |
| LEARN-018 | 1 | the same deadline through JSON. | none | none |
| LEARN-018 | 1 | and 5-. | none | none |
| LEARN-018 | 1 | 1-minute warnings announced in a live region. | none | none |
| LEARN-018 | 2 | Leave. | none | none |
| LEARN-018 | 2 | return. | none | none |
| LEARN-018 | 2 | see the time still running. | none | none |
| LEARN-018 | 2 | let it expire. | none | none |
| LEARN-018 | 2 | see the saved answers scored. | none | none |
| LEARN-018 | 2 | a late answer refused through the page. | none | none |
| LEARN-018 | 2 | JSON. | none | none |
| LEARN-019 | 1 | As the owner. | none | none |
| LEARN-019 | 1 | reset anyone’s open assignment. | none | none |
| LEARN-019 | 2 | As a manager. | none | none |
| LEARN-019 | 2 | reset a teammate’s open assignment after a failed practical. | none | none |
| LEARN-019 | 2 | giving a reason. | none | none |
| LEARN-019 | 2 | see the learner start from the first lesson with a fresh attempt allowance. | none | none |
| LEARN-019 | 2 | and see the earlier lesson progress. | none | none |
| LEARN-019 | 2 | attempts. | none | none |
| LEARN-019 | 2 | rejected evidence in the assignment history. | none | none |
| LEARN-019 | 2 | Audit. | none | none |
| LEARN-019 | 3 | Refuse the manager’s reset of a non-teammate. | none | none |
| LEARN-019 | 3 | with ORG-004. | none | none |
| LEARN-019 | 3 | prove the same check against the manager’s teams. | none | none |
| LEARN-019 | 3 | hierarchy. | none | none |
| LEARN-019 | 4 | Try to reset a completed assignment. | none | none |
| LEARN-019 | 4 | see it refused with the offer to create a new assignment instead. | none | none |
| LEARN-019 | 4 | create it. | none | none |
| LEARN-019 | 4 | see the old completion. | none | none |
| LEARN-019 | 4 | certificate unchanged. | none | none |
| AUTO-001 | 1 | Preview a location. | none | none |
| AUTO-001 | 1 | role rule. | none | none |
| AUTO-001 | 1 | change a person’s HR fields. | none | none |
| AUTO-001 | 1 | run synchronization twice. | none | none |
| AUTO-001 | 1 | inspect additions. | none | none |
| AUTO-001 | 1 | removals. | none | none |
| AUTO-001 | 1 | retained completions. | none | none |
| AUTO-001 | 1 | a reasoned exclusion. | none | none |
| AUTO-001 | 2 | Assign a LIB-006 requirement by role. | none | none |
| AUTO-001 | 2 | location. | none | none |
| AUTO-001 | 2 | see it apply to a person whose HR fields move them into that audience. | none | none |
| AUTO-003 | 1 | Build hire-relative. | none | none |
| AUTO-003 | 1 | prerequisite-relative paths. | none | none |
| AUTO-003 | 1 | enroll around a US daylight-saving transition. | none | none |
| AUTO-003 | 1 | transfer a learner. | none | none |
| AUTO-003 | 1 | compare previewed instants. | none | none |
| AUTO-003 | 1 | unchanged past assignments. | none | none |
| AUTO-004 | 1 | Set annual. | none | none |
| AUTO-004 | 1 | expiry-relative rules. | none | none |
| AUTO-004 | 1 | advance the scheduled job across two cycles. | none | none |
| AUTO-004 | 1 | replay it. | none | none |
| AUTO-004 | 1 | complete a renewal. | none | none |
| AUTO-004 | 1 | inspect retained original certificates. | none | none |
| AUTO-004 | 1 | due dates. | none | none |
| AUTO-004 | 1 | no duplicate open assignment. | none | none |
| AUTO-004 | 1 | advance it past the lead time of a MOVE-009 credited person. | none | none |
| AUTO-004 | 1 | see one renewal assignment due on their credited expiry. | none | none |
| AUTO-005 | 1 | Configure completion. | none | none |
| AUTO-005 | 1 | exhausted-attempt branches through Automation. | none | none |
| AUTO-005 | 1 | complete. | none | none |
| AUTO-005 | 1 | fail the source course. | none | none |
| AUTO-005 | 1 | replay events. | none | none |
| AUTO-005 | 1 | verify the selected next assignment. | none | none |
| AUTO-005 | 1 | a rejected cycle. | none | none |
| AUTO-006 | 1 | Report leave against an overdue course. | none | none |
| AUTO-006 | 1 | approve a temporary deferral. | none | none |
| AUTO-006 | 1 | expire it. | none | none |
| AUTO-006 | 1 | inspect the restored queue plus original deadline. | none | none |
| AUTO-006 | 1 | refuse an unauthorized exemption. | none | none |
| AUTO-006 | 1 | backdated completion. | none | none |
| AUTO-007 | 1 | Preview. | none | none |
| AUTO-007 | 1 | enable an inactivity policy. | none | none |
| AUTO-007 | 1 | advance its notice period. | none | none |
| AUTO-007 | 1 | run it twice. | none | none |
| AUTO-007 | 1 | verify session revocation. | none | none |
| AUTO-007 | 1 | exclusions. | none | none |
| AUTO-007 | 1 | recovery by fresh authorized sign-in. | none | none |
| AUTO-008 | 1 | Dry-run. | none | none |
| AUTO-008 | 1 | enable a scoped native rule. | none | none |
| AUTO-008 | 1 | require. | none | none |
| AUTO-008 | 1 | invalidate an approval. | none | none |
| AUTO-008 | 1 | hold it in quiet hours. | none | none |
| AUTO-008 | 1 | at its rate limit. | none | none |
| AUTO-008 | 1 | deny an unavailable target. | none | none |
| AUTO-008 | 1 | inspect the input. | none | none |
| AUTO-008 | 1 | policy. | none | none |
| AUTO-008 | 1 | actionable failure. | none | none |
| AUTO-008 | 1 | recover. | none | none |
| AUTO-008 | 1 | replay without duplication. | none | none |
| AUTO-008 | 1 | pause all rules. | none | none |
| AUTO-008 | 1 | verify no audience or follow-on effect occurs. | none | none |
| AUTO-009 | 1 | As the owner (admin until ORG-002). | none | none |
| AUTO-009 | 1 | set a course to close 30 days after enrollment. | none | none |
| AUTO-009 | 1 | another to open on a future date. | none | none |
| AUTO-009 | 1 | close a week later. | none | none |
| AUTO-009 | 1 | enroll a learner in each. | none | none |
| AUTO-009 | 1 | see the first open. | none | none |
| AUTO-009 | 1 | the second listed with its opening date but not launchable. | none | none |
| AUTO-009 | 2 | Change a course or path rule. | none | none |
| AUTO-009 | 2 | see it apply only to new assignments. | none | none |
| AUTO-009 | 3 | Prove fixed dates include the whole opening. | none | none |
| AUTO-009 | 3 | closing days in the employer’s time zone. | none | none |
| AUTO-009 | 4 | Advance time past each close. | none | none |
| AUTO-009 | 4 | see “access ended” with records. | none | none |
| AUTO-009 | 4 | certificates still readable. | none | none |
| AUTO-009 | 4 | and learning refused through every current page. | none | none |
| AUTO-009 | 4 | form. | none | none |
| AUTO-009 | 4 | JSON door. | none | none |
| AUTO-009 | 5 | As a manager. | none | none |
| AUTO-009 | 5 | extend a teammate’s closing day by seven days with a reason. | none | none |
| AUTO-009 | 5 | see learning resume when within the extended window. | none | none |
| AUTO-009 | 5 | see the original due date. | none | none |
| AUTO-009 | 5 | the extension in the report. | none | none |
| AUTO-009 | 5 | and refuse an extension for a non-teammate. | none | none |
| AUTO-009 | 6 | Prove an extension of a closed window adds seven days to its current closing day. | none | none |
| LIVE-001 | 1 | Create a blended path with two session options through Programs. | none | none |
| LIVE-001 | 1 | enroll a learner. | none | none |
| LIVE-001 | 1 | reschedule across a time-zone boundary. | none | none |
| LIVE-001 | 1 | compare the calendar invitation. | none | none |
| LIVE-001 | 1 | agenda. | none | none |
| LIVE-001 | 1 | prerequisite gate. | none | none |
| LIVE-002 | 1 | Fill a two-seat session. | none | none |
| LIVE-002 | 1 | waitlist two people. | none | none |
| LIVE-002 | 1 | cancel a seat. | none | none |
| LIVE-002 | 1 | accept. | none | none |
| LIVE-002 | 1 | expire an offer. | none | none |
| LIVE-002 | 1 | issue simultaneous registrations. | none | none |
| LIVE-002 | 1 | inspect capacity. | none | none |
| LIVE-002 | 1 | notifications. | none | none |
| LIVE-002 | 1 | retained enrollment history. | none | none |
| LIVE-003 | 1 | Take attendance through the session roster. | none | none |
| LIVE-003 | 1 | mark one absence. | none | none |
| LIVE-003 | 1 | partial attendance. | none | none |
| LIVE-003 | 1 | amend a mistake. | none | none |
| LIVE-003 | 1 | inspect the timeline. | none | none |
| LIVE-003 | 1 | still-outstanding blended requirements. | none | none |
| NOTICE-004 | 1 | Let a reminder fail while the learner is on leave. | none | none |
| NOTICE-004 | 1 | transfer their manager. | none | none |
| NOTICE-004 | 1 | advance escalation. | none | none |
| NOTICE-004 | 1 | inspect the new manager’s queue. | none | none |
| NOTICE-004 | 1 | fallback route. | none | none |
| NOTICE-004 | 1 | blocker resolution. | none | none |
| NOTICE-004 | 1 | suppression after completion. | none | none |
| REPORT-001 | 1 | Open a manager dashboard for a mixed US workforce. | none | none |
| REPORT-001 | 1 | filter role. | none | none |
| REPORT-001 | 1 | location. | none | none |
| REPORT-001 | 1 | team. | none | none |
| REPORT-001 | 1 | drill into an overdue learner. | none | none |
| REPORT-001 | 1 | reconcile totals against active roster. | none | none |
| REPORT-001 | 1 | exemptions. | none | none |
| REPORT-001 | 1 | revision-bound records. | none | none |
| REPORT-001 | 1 | drill into a person credited under MOVE-009. | none | none |
| REPORT-001 | 1 | see the credit label. | none | none |
| REPORT-001 | 1 | decision. | none | none |
| REPORT-001 | 1 | expiry. | none | none |
| REPORT-001 | 1 | and see them counted as current. | none | none |
| REPORT-002 | 1 | Save. | none | none |
| REPORT-002 | 1 | share a team dashboard with a named leader. | none | none |
| REPORT-002 | 1 | an expiring field-limited link. | none | none |
| REPORT-002 | 1 | attempt another team. | none | none |
| REPORT-002 | 1 | revoke the share. | none | none |
| REPORT-002 | 1 | inspect redacted fields. | none | none |
| REPORT-002 | 1 | denied access. | none | none |
| REPORT-003 | 1 | Download CSV. | none | none |
| REPORT-003 | 1 | XLSX. | none | none |
| REPORT-003 | 1 | a transcript for repeated completions. | none | none |
| REPORT-003 | 1 | imported history. | none | none |
| REPORT-003 | 1 | compare every attempt. | none | none |
| REPORT-003 | 1 | source id to the timeline. | none | none |
| REPORT-003 | 1 | reconcile absent. | none | none |
| REPORT-003 | 1 | partial live attendance plus superseding corrections across the page. | none | none |
| REPORT-003 | 1 | JSON. | none | none |
| REPORT-003 | 1 | CSV. | none | none |
| REPORT-003 | 1 | XLSX while retaining earlier completion evidence. | none | none |
| REPORT-003 | 1 | and export a larger cohort with formula-like names. | none | none |
| REPORT-005 | 1 | Run a program with drop-offs. | none | none |
| REPORT-005 | 1 | retries. | none | none |
| REPORT-005 | 1 | feedback. | none | none |
| REPORT-005 | 1 | inspect course. | none | none |
| REPORT-005 | 1 | revision trends. | none | none |
| REPORT-005 | 1 | effort. | none | none |
| REPORT-005 | 1 | and verify private practice. | none | none |
| REPORT-005 | 1 | anonymous answers cannot be drilled into as individual performance. | none | none |
| CONNECT-014 | 1 | Issue separate read-report. | none | none |
| CONNECT-014 | 1 | enrollment credentials through Access. | none | none |
| CONNECT-014 | 1 | page through reports. | none | none |
| CONNECT-014 | 1 | replay enrollment. | none | none |
| CONNECT-014 | 1 | rotate. | none | none |
| CONNECT-014 | 1 | revoke a credential. | none | none |
| CONNECT-014 | 1 | refuse publication. | none | none |
| CONNECT-014 | 1 | foreign audience. | none | none |
| CONNECT-014 | 1 | cross-scope reads. | none | none |
| CONNECT-016 | 1 | Authorize an MCP client. | none | none |
| CONNECT-016 | 1 | search permitted material. | none | none |
| CONNECT-016 | 1 | prepare a course proposal. | none | none |
| CONNECT-016 | 1 | request a private team report. | none | none |
| CONNECT-016 | 1 | publication. | none | none |
| CONNECT-016 | 1 | privilege change outside its grants. | none | none |
| CONNECT-016 | 1 | revoke. | none | none |
| CONNECT-016 | 1 | verify tools stop. | none | none |
| CONNECT-016 | Requirement | Company-policy computation for the declared classes. | none | none |
| OPS-001 | 1 | Perform a course publication. | none | none |
| OPS-001 | 1 | access revocation. | none | none |
| OPS-001 | 1 | automation. | none | none |
| OPS-001 | 1 | agent approval through public doors. | none | none |
| OPS-001 | 1 | find each in Audit. | none | none |
| OPS-001 | 1 | export it. | none | none |
| OPS-001 | 1 | attempt editing. | none | none |
| OPS-001 | 1 | removing events. | none | none |
| OPS-001 | 1 | inspect preserved decision lineage. | none | none |
| OPS-001 | Requirement | Company-policy computation for the declared classes. | none | none |
| OPS-002 | 1 | Export a mixed native. | none | none |
| OPS-002 | 1 | package estate through Data export. | none | none |
| OPS-002 | 1 | inspect the manifest. | none | none |
| OPS-002 | 1 | counts. | none | none |
| OPS-002 | 1 | read open-format records independently. | none | none |
| OPS-002 | 1 | scan for planted secrets. | none | none |
| OPS-002 | 1 | disclosed licensed exclusions. | none | none |
| OPS-002 | Requirement | Company-policy computation for the declared classes. | none | none |
| OPS-006 | 1 | in a fresh checkout run setup. | none | none |
| OPS-006 | 1 | dev. | none | none |
| OPS-006 | 1 | publish. | none | none |
| OPS-006 | 1 | complete native learning. | none | none |
| OPS-006 | 1 | build. | none | none |
| OPS-006 | 1 | dry-run deployment. | none | none |
| OPS-006 | 1 | export. | none | none |
| OPS-006 | 1 | restore. | none | none |
| OPS-006 | 1 | connect a real provider for its feature. | none | none |
| OPS-006 | 1 | inspect actionable missing-credential diagnostics. | none | none |
| OPS-006 | Requirement | Company-policy computation for the declared classes. | none | none |
| OPS-007 | 1 | Run the installation’s Base-copy. | none | none |
| OPS-007 | 1 | source-lock. | none | none |
| OPS-007 | 1 | first-party checks. | none | none |
| OPS-007 | 1 | exercise sign-in. | none | none |
| OPS-007 | 1 | revocation. | none | none |
| OPS-007 | 1 | mail failure. | none | none |
| OPS-007 | 1 | import. | none | none |
| OPS-007 | 1 | export through their public doors. | none | none |
| OPS-007 | 1 | repeat those outcomes before accepting a component replacement. | none | none |
| OPS-009 | 1 | Set up a US multi-state employer. | none | none |
| OPS-009 | 1 | select reviewed employee. | none | none |
| OPS-009 | 1 | contractor audiences. | none | none |
| OPS-009 | 1 | daylight-saving deadlines. | none | none |
| OPS-009 | 1 | inspect USD provider costs. | none | none |
| OPS-009 | 1 | verify no learning action writes employment. | none | none |
| OPS-009 | 1 | payroll decisions. | none | none |
| AGENT-001 | 1 | Authorize a scoped support or error feed. | none | none |
| AGENT-001 | 1 | select a training cohort. | none | none |
| AGENT-001 | 1 | request diagnosis. | none | none |
| AGENT-001 | 1 | inspect source ids. | none | none |
| AGENT-001 | 1 | redactions. | none | none |
| AGENT-001 | 1 | reject an out-of-scope record. | none | none |
| AGENT-001 | 1 | revoke the connection without retaining unauthorized searchable text. | none | none |
| AGENT-001 | Requirement | Company-policy computation for the declared classes. | none | none |
| AGENT-002 | 1 | give the agent one genuine knowledge gap. | none | none |
| AGENT-002 | 1 | one unusable process with trained staff. | none | none |
| AGENT-002 | 1 | review its cited alternatives. | none | none |
| AGENT-002 | 1 | approve a voluntary question plan. | none | none |
| AGENT-002 | 1 | reject an unsupported training recommendation. | none | none |
| AGENT-002 | Requirement | Company-policy computation for the declared classes. | none | none |
| AGENT-003 | 1 | review an error diagnosis affecting one role. | none | none |
| AGENT-003 | 1 | inspect a minimal intervention against a broad-course alternative. | none | none |
| AGENT-003 | 1 | approve only the selected people. | none | none |
| AGENT-003 | 1 | actions. | none | none |
| AGENT-003 | 1 | reject a changed payload. | none | none |
| AGENT-003 | 1 | inspect decision lineage. | none | none |
| AGENT-003 | Requirement | Company-policy computation for the declared classes. | none | none |
| AGENT-004 | 1 | change one procedure step. | none | none |
| AGENT-004 | 1 | request an impact proposal. | none | none |
| AGENT-004 | 1 | inspect affected passages. | none | none |
| AGENT-004 | 1 | questions. | none | none |
| AGENT-004 | 1 | roles versus untouched content. | none | none |
| AGENT-004 | 1 | decline retraining. | none | none |
| AGENT-004 | 1 | approve a revised exact proposal. | none | none |
| AGENT-004 | 1 | compare old completions. | none | none |
| AGENT-004 | Requirement | Company-policy computation for the declared classes. | none | none |
| AGENT-005 | 1 | approve a metric. | none | none |
| AGENT-005 | 1 | baseline through the intervention page. | none | none |
| AGENT-005 | 1 | import scoped pre. | none | none |
| AGENT-005 | 1 | post outcomes with missing rows. | none | none |
| AGENT-005 | 1 | a process change. | none | none |
| AGENT-005 | 1 | inspect the comparison. | none | none |
| AGENT-005 | 1 | refusal to assert causation or rank employees. | none | none |
| AGENT-005 | Requirement | Company-policy computation for the declared classes. | none | none |
| AGENT-006 | 1 | present an overdue learner on leave with bounced mail. | none | none |
| AGENT-006 | 1 | a full assessor calendar. | none | none |
| AGENT-006 | 1 | review the agent’s blocked-work plan. | none | none |
| AGENT-006 | 1 | approve a substitute slot or manager. | none | none |
| AGENT-006 | 1 | inspect delivery. | none | none |
| AGENT-006 | 1 | retained original dates. | none | none |
| AGENT-006 | Requirement | Company-policy computation for the declared classes. | none | none |
| AGENT-008 | 1 | close a measured intervention with no observed improvement. | none | none |
| AGENT-008 | 1 | review the agent’s uncertainty. | none | none |
| AGENT-008 | 1 | alternatives. | none | none |
| AGENT-008 | 1 | retire only future redundant assignments by manager approval. | none | none |
| AGENT-008 | 1 | verify unchanged historical outcomes. | none | none |
| AGENT-008 | 1 | evidence. | none | none |
| AGENT-008 | Requirement | Company-policy computation for the declared classes. | none | none |
| LEARN-020 | 1 | Bind the request to every passage's immutable source identity. | none | none |
| LEARN-020 | 1 | digest. | none | none |
| LEARN-020 | 1 | instruction. | none | none |
| LEARN-020 | 1 | response-schema versions. | none | none |
| LEARN-020 | 1 | provider. | none | none |
| LEARN-020 | 1 | model. | none | none |
| LEARN-020 | 1 | configuration. | none | none |
| LEARN-020 | 1 | estimate. | none | none |
| LEARN-020 | 1 | request limit. | none | none |
| LEARN-020 | 2 | Invalidate unused consent on relevant payload. | none | none |
| LEARN-020 | 2 | grant. | none | none |
| LEARN-020 | 2 | access or configuration change. | none | none |
| LEARN-020 | 2 | expiry or use. | none | none |
| LEARN-020 | 2 | merely opening. | none | none |
| LEARN-020 | 2 | questioning. | none | none |
| LEARN-020 | 2 | granting a source or receiving no answer authorizes no paid request. | none | none |
| LEARN-020 | 3 | Recheck permissions. | none | none |
| LEARN-020 | 3 | pending erasure before sending. | none | none |
| LEARN-020 | 3 | accepting a response. | none | none |
| LEARN-020 | 3 | reading every answer. | none | none |
| LEARN-020 | 3 | citation. | none | none |
| LEARN-020 | 3 | download. | none | none |
| LEARN-020 | 3 | revocation invalidates stored results. | none | none |
| LEARN-020 | 3 | unused consent. | none | none |
| LEARN-020 | 3 | regrant never revives them. | none | none |
| LEARN-020 | 4 | Load permitted. | none | none |
| LEARN-020 | 4 | restricted source canaries. | none | none |
| LEARN-020 | 4 | private learner data. | none | none |
| LEARN-020 | 4 | inspect the complete outbound request. | none | none |
| LEARN-020 | 4 | verify exact consent with no additional data. | none | none |
| LEARN-020 | 5 | Revoke authority during a request. | none | none |
| LEARN-020 | 5 | retry stale. | none | none |
| LEARN-020 | 5 | consumed consent. | none | none |
| LEARN-020 | 5 | result reads. | none | none |
| LEARN-020 | 5 | citation downloads disclose no withdrawn material. | none | none |
| LEARN-020 | Requirement | Company-policy computation for the declared classes. | none | none |
| LEARN-021 | 1 | Supply irrelevant. | none | none |
| LEARN-021 | 1 | partial. | none | none |
| LEARN-021 | 1 | conflicting. | none | none |
| LEARN-021 | 1 | injected provider selections. | none | none |
| LEARN-021 | 1 | observe safe refusal or an unanswered question. | none | none |
| LEARN-021 | 1 | a working expert route. | none | none |
| LEARN-021 | 2 | No tutor action records an assessment pass. | none | none |
| LEARN-021 | 2 | completion. | none | none |
| LEARN-021 | 2 | competence judgment or employee rating. | none | none |
| LEARN-021 | 3 | Exercise the learner. | none | none |
| LEARN-021 | 3 | owner. | none | none |
| LEARN-021 | 3 | expert screens at 1440. | none | none |
| LEARN-021 | 3 | 390. | none | none |
| LEARN-021 | Requirement | Company-policy computation for the declared classes. | none | none |
| LEARN-022 | 1 | An exact request consent never raises the installation ceiling. | none | none |
| LEARN-022 | 2 | Failed. | none | none |
| LEARN-022 | 2 | unknown outcomes retain reservations. | none | none |
| LEARN-022 | 2 | never cause automatic retries or background spending. | none | none |
| LEARN-022 | 3 | At a zero or exhausted ceiling. | none | none |
| LEARN-022 | 3 | including concurrent requests. | none | none |
| LEARN-022 | 3 | failed or unknown outcomes. | none | none |
| LEARN-022 | 3 | reconcile reservations. | none | none |
| LEARN-022 | 3 | visible billing uncertainty in Settings. | none | none |
| LEARN-022 | 3 | JSON. | none | none |
| LEARN-022 | Requirement | Company-policy computation for the declared classes. | none | none |
| LEARN-023 | 1 | Inspect audit output for stable actor. | none | none |
| LEARN-023 | 1 | subject ids. | none | none |
| LEARN-023 | 1 | question. | none | none |
| LEARN-023 | 1 | request ids. | none | none |
| LEARN-023 | 1 | consent notice version. | none | none |
| LEARN-023 | 1 | time. | none | none |
| LEARN-023 | 1 | source. | none | none |
| LEARN-023 | 1 | revision ids. | none | none |
| LEARN-023 | 1 | grant versions. | none | none |
| LEARN-023 | 1 | payload digest. | none | none |
| LEARN-023 | 1 | provider. | none | none |
| LEARN-023 | 1 | model. | none | none |
| LEARN-023 | 1 | configuration. | none | none |
| LEARN-023 | 1 | policy versions. | none | none |
| LEARN-023 | 1 | approval identity. | none | none |
| LEARN-023 | 1 | time. | none | none |
| LEARN-023 | 1 | USD estimate. | none | none |
| LEARN-023 | 1 | reservation. | none | none |
| LEARN-023 | 1 | action. | none | none |
| LEARN-023 | 1 | outcome. | none | none |
| LEARN-023 | 1 | value-free failure code. | none | none |
| LEARN-023 | 2 | Verify that question bodies. | none | none |
| LEARN-023 | 2 | passages. | none | none |
| LEARN-023 | 2 | answers. | none | none |
| LEARN-023 | 2 | credentials. | none | none |
| LEARN-023 | 2 | session secrets are absent from audit output. | none | none |
| LEARN-023 | Requirement | Company-policy computation for the declared classes. | none | none |
| LEARN-024 | 1 | As owner. | none | none |
| LEARN-024 | 1 | grant a second learner 50% extra time under LEARN-011. | none | none |
| LEARN-024 | 1 | see a 15-minute limit. | none | none |
| LEARN-024 | 1 | the recorded accommodation. | none | none |
| LEARN-024 | 2 | Prove a manager can grant it to a teammate. | none | none |
| LEARN-024 | 2 | is refused for a non-teammate. | none | none |
| LEARN-024 | 2 | grant two course accommodations. | none | none |
| LEARN-024 | 2 | see the newest win. | none | none |
| LEARN-008 | old 2 | The ct custody decision moved to RULINGS.md RL-1. | none | moved |
| LEARN-018 | old 5 | Native countdown, warnings and offline-start refusal remain in LEARN-004 and LEARN-005. | none | moved |
| AUTO-009 | old 7 | Native reconnect refusal remains in LEARN-004 and LEARN-005. | none | moved |
| AUTO-008 | old 2 | Provider denial, replay and spend controls remain requirements on each named provider door. | none | moved |
