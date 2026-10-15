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
