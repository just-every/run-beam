Your own AI agent can prepare work in Beam. Beam itself calls no model: the agent is yours, and nothing it prepares reaches staff until a person approves it.

## What an agent can prepare

- **Course drafts**, with the source passages they rely on and what is missing.
- **Assignment plans**: who should take which course, and by when.
- **Reminders** for open assignments.
- **Question plans**: optional questions for staff, with answers shown without names.
- **Process changes** for a manager to decide.
- **Practice scenarios** for a course.

## Give your agent access

A person signed in with an ordinary email link issues the agent a short-lived credential that carries their own current roles. The credential expires within an hour, and signing out or removing the person's access revokes it. The agent works through Beam's JSON API, described in [AGENTS.md](https://github.com/just-every/run-beam/blob/main/AGENTS.md) in the repository.

## Approve or decline

Open **Agent work**. **Waiting** lists every proposal with who prepared it and from what, the **Reasons**, anything **Excluded**, and a **Preview** of exactly what approving will create. Add a note if you like, then **Approve** or **Decline**. Approved and declined proposals keep the decision, the note and what it created.

Course drafts are decided on their course page, and a practice scenario is deployed by the course's reviewer.

## Questions for staff

An approved question plan appears to the people it asks under **Questions for you**. Answering is optional. Answers are shown to the manager without names, only after the questions close and only if at least three people answered. They are never used to rate anyone.

## Measuring an intervention

Before you decide an intervention, choose how its effect on work will be measured on its card under **Measuring the outcome**: the outcome and its unit, whether lower or higher is better, a baseline period and an after period, whether the rest of the role is the comparison group, and the smallest group whose result is shown (at least 3). Your agent may prepare this plan; only a person approves it. Once the intervention is applied, import the outcomes as a CSV with **Employee ID**, **Date** and **Value** columns (a blank value counts as missing) and note any process changes in those periods. Beam keeps only rows for people you manage in the two periods and lists every other row it refused.

The comparison shows each group's before and after averages, its change with an approximate 95% interval, the difference from the comparison group, missing data, process changes and small-sample limits. It is shown for groups only, to the owner, the manager who approved the plan and managers whose teams include its people. A group smaller than the bound, or one that differs from an earlier plan's group by fewer people than the bound, is hidden. It never ranks or lists anyone, and does not claim the training caused the change: completion proves neither competence nor causation.

Once the after period has ended, the owner or the manager who approved the plan chooses **Close the measurement and evaluate**. Beam prepares the evaluation by rule, not by a model: improved, no observed improvement, worse, or not measurable, from whether the interval of the difference (or of the group's own change, without a comparison group) lies on the better side of zero, includes it, or lies on the worse side. It names process changes recorded in the periods and offers alternatives: revised practice, a process fix and, unless the outcome improved, retiring the intervention's assignments that are still open. No more outcomes can be imported once it is closed, and the finding stays on the card. Retiring is your decision: tick the open assignments of people in your teams and choose **Retire the selected assignments**. Each is cancelled with the evaluation as its reason; completed assignments, completions, certificates and outcomes never change.
