Beam is for one business and its adult staff. The owner decides who can sign in and what each person does.

## Roles

Each person has one or more roles. The owner holds every role.

| Role | What they do |
| --- | --- |
| Learner | Completes the courses assigned to them. |
| Author | Uploads sources and builds courses. |
| Reviewer | Publishes or returns the revisions of the courses they review. |
| Manager | Assigns training, works the queues, records offline training and reads everyone's records. |
| Assessor | Decides practical evidence sent to them by name. |

## Invite a staff member

Open **People** and use **Invite a staff member**: enter their **Name** and **Email**, tick their **Roles** and any **Teams**, and press **Send invitation**. The invitation is an ordinary sign-in email. While you run Beam on your own computer, nothing is sent: the invitation answers as sent and the person signs in once Beam is hosted.

To change someone's roles later, open their roles in the **People** table, tick the ones they need and press **Save roles**.

## Import a roster

Under **Import a roster** on **People**, upload a CSV or XLSX file with a header row; each row needs a work email or an
employee ID. Beam matches columns by name (Employee ID, Name, Email, Username or Login, Mobile, Employment, Manager
employee ID, Role, Department, Location, Hire date, Transfer date, Team and your directory fields); open **Column
mapping** to change any of them and **Preview again**. The preview changes nothing and sends nothing: it lists each row
as an addition (with an invitation when you chose to invite new people who have an email), an update, a transfer, a
deactivation (employment terminated or inactive), no change, a conflict to hold, or a row that will not apply and why
(no email and no employee ID, an email, employee ID or username repeated in the file, an unknown manager or team).
People missing from the file stay as they are unless the owner chooses to deactivate them. Choose the rows and **Apply
the selected rows**: Beam applies 50 rows at a time and you **Continue applying** until it is done; each row shows its
outcome, and applying again never repeats a change or an invitation. Base sends at most 30 invitations from one address
in 15 minutes, so a large file's later invitations wait and go out when you continue later. People without an email
keep their username and mobile number and are never emailed.

## Teams

Teams group people who need the same training, such as a front desk. As the owner, add one under **Teams** with **Add team**, then open it and tick its **Members**. You can assign a course to a whole team, and a [role path](/docs/assign#role-paths) belongs to one team.

Tick a team's **Managers** to say who manages it. A manager assigns, reports, follows up, moves due dates and grants retries only for the people in the teams they manage; everyone else's records stay closed to them. A team's manager (or you) can **Hand this team to someone for a while**: pick the covering manager, the last day and the reason. Coverage ends by itself after that day, or early with **End coverage**.

## Business units and learning administrators

A business unit groups teams, such as every team in one region. As the owner, open **Business units and administrators** on **People**, add a unit under **New business unit** and tick its **Teams**. Put a course in a unit from its course page under **Business unit**.

Under **Grant administration**, choose a person and a unit to make them that unit's learning administrator, with an optional end date. They manage the unit's courses, assign its people, invite new learners into its teams and set those teams' members, set and extend the access window of the enrollments they made, and read its reports and CSV, and nothing else: other units, other roles, team managers, settings, sign-in and providers stay with you. **Revoke** ends a grant at once; an ended or revoked grant stays listed with when and by whom.

## Custom roles

Under **Custom roles** on **People**, the owner makes a role such as a site training coordinator: name it, tick its **Permissions** (courses, people, enrollment, reports, live sessions, certificates, integrations, notifications) and limit it to chosen teams or business units. Owner settings, sign-in providers and named reviewer or assessor decisions are never part of a role. Give it to someone with **Grant role**; saving the role again changes it for every holder on their next page, and **Revoke** takes it away.

## View as a learner

To see exactly what someone in your care sees, open their record (from **Manage** or **People**) and press **View as**. Beam shows their pages, read-only, under a banner naming them, for 15 minutes or until you press **Exit view**: nothing you do changes their training, and their practice and anonymous answers stay private. The owner, a learning administrator for their unit's people and a manager for their teams can do this; nobody can view the owner or another administrator. Each view is recorded in **Audit**.

## Auditors

To let an auditor check training records, open **Auditors** on **People** and use **Share evidence with an auditor**: pick the person, the **Teams**, the period the completions fall in and when access ends. The auditor opens **Shared evidence** and sees those completions with their certificates and evidence files, changes nothing, and loses access at the end date or when you press **Revoke**.

## Remove or restore access

**Remove access** signs the person out everywhere and stops them signing in. Their records stay. **Restore access** lets them sign in again with a fresh sign-in link.

After a [restore from a backup](/docs/backup), staff show **Needs an invitation**: archives never carry sign-in accounts. Press **Restore access** and Beam sends them an ordinary invitation; when they sign in, their records and certificates are all there.

## Inactive accounts

The owner sets an inactivity policy at the foot of **People**: 30–730 calendar days without a sign-in in the business time zone, 7–60 elapsed 24-hour days of notice, and protected teams and roles. The owner, assessors with evidence waiting and anyone with an open blocker or exception are always protected. Save, **Preview this policy**, then **Switch on**. The preview lists planned notices, removals and protected people; it changes no access. **Run now** performs the reviewed policy using your current owner session.

For unattended work, review **Daily automatic run** and its complete definition and SHA-256, then **Approve daily automatic run** from an ordinary, recently authenticated owner sign-in. Development and review sessions cannot delegate scheduled authority. The Worker runs at 08:00 UTC, removes at most 100 accounts per tick and admits runs at least 23 hours apart so a tick's processing time does not skip the following day. Notices and cancellations use the same rule. The standing approval survives signing out; **Revoke automatic authority** stops it, and any policy change needs a fresh preview, enable and approval. The history shows outcomes and refusals, with older records available through the linked JSON history. There are no provider calls or hidden retries.

Notices appear on **My learning** only; no email is sent. A new sign-in or protection cancels a notice. When the notice expires, Base removes access and ends sessions; completions, certificates and evidence stay. **Restore access** allows a fresh sign-in; old sessions remain ended. Base retains the last sign-in even after old sessions are deleted. On upgrade, accounts with unknown history receive a conservative fresh inactivity window.

## Announcements

Open **Announcements** to write to the people of a team you look after, or to everyone you look after who is assigned a course. Each person sees it on **My learning** with your name, never who else received it, and can **Reply privately**; replies appear under your announcement and nobody else reads them. Announcements are delivered in Beam only for now: email, Slack and Teams delivery are not sent yet.

## Instructors

Under **Instructors** on **People**, **Give instructor access** to a person for every course or one business unit's courses, with an optional end date. Only people with that access can be named on a session, and they keep its roster and attendance while it lasts; **Revoke** ends it at once. Instructor access changes no course, assignment, completion or person.

## Connect other systems

The owner gives another system (an HR system, a BI tool, an intranet) its own credential under **Access**. Each credential does one thing: read the roster, read the catalog, enroll people, read the training report, or submit external certificates (they wait for their reviewer like any upload), for the whole business or only the teams you tick. It expires after the days you choose (up to 90), is shown once, and is limited to 60 requests a minute. **Rotate** gives a new token and stops the old one at once; **Revoke** ends it. A credential can never publish a course, change roles or access, or act as a person, and everything it changes appears in the audit under its name.
