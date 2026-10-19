Managers and the owner assign training on **Manage** and follow it up from the same page. A manager works only with the people in the [teams they manage](/docs/people#teams). To move one person's due date, open their assignment and use **Due date exception** with a reason; the earlier date stays in its history.

## Assign a course

Under **Assign a course**, choose the **Course**, tick **People** or whole **Teams**, and set the **Due date**, **Due time** and **Time zone**. Press **Assign**. People who already have an open assignment for the course keep it.

Every assignment names the course revision that was published when it was made.

## Role paths

A role path lists the courses a team needs, in order. Open **Paths**, use **New path** to name it and pick its team, then **Edit requirements**: for each course, choose an optional **Prerequisite**, when it is **Due** (a number of days after enrollment, the person's hire date, their transfer date or completing the prerequisite, or on a fixed date) and how often to **Renew every (days)**. **Save as new revision** keeps earlier assignments on the path revision they came from, with their dates.

**Due dates if assigned now** lists every member's dates before anything is assigned. Dates are due at 5 pm in the person's own time zone (their directory **Time zone**, otherwise the business's), so a daylight-saving change never moves the local hour. **Assign to the team** gives every member of the team the path's courses; someone without the hire or transfer date a course is due after is left out and named. A course behind a prerequisite stays locked until the prerequisite is complete; when it is, the course becomes due its days after that completion.

## The queues

The top of **Manage** shows what needs you. Four count cards (**Completed**, **Expiring in 30 days**, **Overdue**, **Open**) count every training record once and pick the queue below them. The team chips and **Filters** narrow the whole page: **Filters** lists the statuses, the teams and the published courses as links, and **Open these records in the report** opens the same records in **Reports**.

Choose a person in the queue to see their record in the panel beside it. With nobody chosen, the panel opens on the first record that a plan waiting for your decision names. There you can:

- **Record decision** on that plan: send the drafted reminders, or decline the plan.
- **Grant one more attempt** to someone out of quiz attempts, with a **Reason for another attempt**.

In the **Expiring in 30 days** queue, **Assign all renewals** assigns each expiring course again.

## Record offline training

For training held in person, use **Record offline training**: choose the **Course** and the **Attested revision**, tick the **Attendees**, and fill in **Held on**, **Instructor**, **Location** and the **Attestation**. Attach a signed attendance sheet if you have one. Each attendee gets a completion and a certificate for that revision. Nobody can attest their own attendance; ask another manager or the owner.

## Learner records

**Learner records** lists everyone. Open a person to see their assignments, completions with certificates, and any [imported history](/docs/move-in).

## Follow-on rules

Open **Automation** (the owner, or a learning administrator for their units' courses) to assign the next course
automatically. A rule says: when a learner is enrolled in a course, completes it (optionally only with a best quiz score
of at least a percentage), or runs out of its quiz attempts without a pass, assign another course due a number of days
later; it can be limited to one team. A new rule is a draft: press **Dry run** to see who it would assign today, without
assigning anyone, then **Enable**. **Replay past events** runs it over what already happened. A rule acts once per
event, keeps an open assignment rather than adding another, never turns a failure into a pass, and a rule that would
loop back to its own course is refused. **Pause** stops it.

## Audiences

**Automation** also keeps audiences: groups that follow the employee directory. An audience names roles, locations,
departments, teams, managers, custom-field values (an "Employment type" custom field, for example), how recently people
were hired or transferred, and whether people on leave belong; different conditions must all hold, and the values listed
for one condition are alternatives. It can enroll a course due a number of days after joining. Press **Preview** to see
who would join and leave, without changing anything, then **Enable**. From then on every roster change (an import, a
directory edit, a team change) synchronizes it, and so does **Synchronize now**: people who now match join and are
enrolled unless they already have the course open or completed, and people who no longer match, go on leave or leave
the business leave the audience with that reason. Leaving withdraws only the open assignment the audience made;
completions and evidence stay. **Exclude** keeps one person out with a reason, until you lift it. A transfer is a change
of role, department or location; its date is today unless the edit or roster row gives one. External-certificate
requirements can apply to audiences as well as teams.
