# Beam change history

## 2026-10-28 — Contract structure rewrite

Acceptance and claims now derive from CONTRACT.md. Statuses retain the last judgment; no implementation is certified by the rewrite. Rulings are in RULINGS.md and operating details in docs/learning-mechanics.md.

## Approved scope coverage

| Approved input | Named clauses |
| --- | --- |
| Complete employee LMS, role-based onboarding, compliance and renewals | BEAM-01–20; ORG-001–008, ORG-011–012; AUTO-001–009; LEARN-018–019; LIB-001–006; MOVE-009 |
| SCORM 1.2/2004, xAPI and cmi5 course import and playback | PACK-001–005, PACK-007, MOVE-001–009 |
| Licensed US harassment (CA/NY/IL), OSHA, HIPAA and security content | LIB-001–005 |
| Willow/BambooHR/Rippling/Gusto HR sync and Google/Microsoft SSO | AUTO-001–003, CONNECT-001–009, CONNECT-017–020 |
| Delivered email/Slack/Teams and overdue manager escalation | NOTICE-001–006, AUTO-004–008 |
| Native mobile/offline, video and AI document authoring | LEARN-003–006, LEARN-017, AUTHOR-001–002, AUTHOR-007–008, AUTHOR-010 |
| Live/ILT scheduling with Zoom/Teams and compliance dashboards | LIVE-001–006, REPORT-001–005 |
| All inventory standards, integrations, automation and premium capabilities | AUTHOR-001–010, PACK-001–007, ORG-008–012, LEARN-001–019, CONNECT-001–020, AUTO-001–009 |
| Agent links procedure changes and operational errors, diagnoses, minimizes and measures | AGENT-001–008; BEAM-14, BEAM-18–20 |

## Export and library source references

These official export descriptions define intake checklists, not a claim that
Beam’s target importers already work. Tenant permissions, filters, schema and
download rights must be checked with real owner-authorized exports:
[TalentLMS portal export](https://help.talentlms.com/hc/en-us/articles/9651492281756-How-to-import-export-data-in-TalentLMS)
and [history reports](https://help.talentlms.com/hc/en-us/articles/9652213844892-How-to-export-course-reports-in-TalentLMS);
[Trainual content PDFs](https://help.trainual.com/en/export-and-print-content-pdfs)
and [reports](https://help.trainual.com/en/reports);
[Docebo user exports](https://help.docebo.com/hc/en-us/articles/360020126399-Managing-users-with-mass-actions)
and [GIFT limits](https://help.docebo.com/hc/en-us/articles/360020083960-Managing-tests-in-GIFT-format);
[iSpring users](https://ispringhelpdocs.com/ispring-learn/export-users-to-excel-141558808.html)
and [Pages packages](https://ispringhelpdocs.com/ispring-learn/exporting-pages-17303161.html);
[360Learning course/JSON downloads](https://support.360learning.com/hc/en-us/articles/360030087352-Download-a-course);
[Sana exports](https://help.sana.ai/en/articles/153672-sana-integration-capabilities)
and [Sana-dependent SCORM connectors](https://help.sana.ai/en/articles/29602-exporting-sana-courses-with-scorm);
[Arist CSV exports](https://help.arist.co/article/1061-exports)
and [Word/PDF course exports](https://help.arist.co/article/1132-june-2026-product-updates).
Licensed-content procurement examples are [Traliant](https://www.traliant.com/traliant-faqs/)
and [HSI SCORM delivery](https://hsi.com/solutions/employee-training-and-development/scorm-aicc-compliant-training-courses/);
provider marketing does not replace employer applicability review or license agreements.
Round-1 buyer gaps cite [TalentLMS BambooHR write-back](https://help.talentlms.com/hc/en-us/articles/9651541673372-How-to-integrate-TalentLMS-with-BambooHR)
and the [BambooHR training-record API](https://documentation.bamboohr.com/reference/add-new-employee-training-record-2);
[notifications](https://help.talentlms.com/hc/en-us/articles/9651467334044-How-to-work-with-notifications-in-TalentLMS);
[question types](https://help.talentlms.com/hc/en-us/articles/9652288801820-What-are-the-available-question-types)
and [GIFT/Aiken import](https://help.talentlms.com/hc/en-us/articles/9652304102428-How-to-import-questions-in-the-GIFT-AIKEN-formats);
[updating live course content](https://help.talentlms.com/hc/en-us/articles/360014574594-How-updating-course-content-affects-the-users-assigned-to-that-course);
[themes](https://help.talentlms.com/hc/en-us/articles/20571132132124-How-to-customize-your-themes-in-TalentLMS);
and [interface language](https://help.talentlms.com/hc/en-us/articles/9652290507036-How-can-users-view-your-portal-in-their-preferred-language).
Round-2 cites [users without an email address](https://help.talentlms.com/hc/en-us/articles/360014574694-How-to-create-new-users-without-their-email-address),
the [user import Login and Password columns](https://help.talentlms.com/hc/en-us/articles/9652274499484-How-to-add-multiple-users-to-your-TalentLMS-portal-at-once-Import-guide)
and [course time limits and expiry](https://help.talentlms.com/hc/en-us/articles/9651386888092-How-to-work-with-time-limits-and-expired-courses).
Round-3 cites [historical completion import](https://help.talentlms.com/hc/en-us/articles/9651492232988-How-to-import-historical-completion-data-in-TalentLMS-for-courses-or-learning-paths),
[certifications](https://help.talentlms.com/hc/en-us/articles/9651316373148-How-to-work-with-certifications),
[re-assignment before certification expiry](https://help.talentlms.com/hc/en-us/articles/9651339325340-How-to-re-assign-courses-to-users-before-a-certification-expires-in-TalentLMS),
[compliance re-assignment on expiry](https://help.talentlms.com/hc/en-us/articles/360014657573-How-to-use-TalentLMS-for-compliance-training)
and Docebo’s [external compliance training](https://community.docebo.com/product-q-a-7/help-pls-how-does-your-company-manage-external-compliance-training-in-docebo-8558).


## 2026-10-28 — Prior judgment notes moved from DONE gaps

LEARN-008: Inherited obligations: OPS-003 and OPS-005 retain real provider deletion, custody, retention and legal qualification. OPS-009 and AUTO-008 retain provider billing qualification beyond estimated USD reservations. AUTHOR-002, AUTHOR-007 and AUTHOR-008 retain extraction, preparation, translation and human review; LIB-001 through LIB-005 retain entitlement and content rights. No provider retention, deletion, billing cap or legal result is claimed.

OPS-006: Done: setup and dev, native publish and completion, build and dry-run deployment, export and restore, and one real provider connect with actionable missing-credential diagnostics are each proved above. Hosted account qualification beyond the dry run is not an acceptance point of this clause.

