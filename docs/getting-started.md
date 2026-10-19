Beam runs on your own computer with one command, `rer`. Nothing needs an account with anyone, and no email leaves your computer while you try it.

## Get Beam and start it

Two lines, the same as the [Run Beam](/run) page. The first installs the Run Edit Run command, `rer`, for you alone, with its own Node if you have no Node 22 or later. The second gets Beam and starts it:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
rer dev just-every/run-beam
```

If the installer's last line puts `rer` on your PATH, run that line before the second one. Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-beam` does both steps in one line.

To start Beam again later, run `cd run-beam && rer dev`. Beam runs on macOS, Linux or Windows with WSL2; the installer brings Node when it is missing, and `rer` selects the exact Node and pnpm versions itself.

`rer dev` installs everything, makes you the owner and prints a link that opens Beam signed in. The link is a key to your copy of Beam: open it on this computer and do not share it.

If you want to choose the owner's email address yourself first, run `npx -y @runeditrun/rer install just-every/run-beam`, then setup from the checkout before `rer dev`:

```sh
rer setup --owner-email you@example.com
```

## Finish setup

The first time you open Beam as the owner you see **Finish setup**. Check the name and email of the owner account, tick **I confirm this owner account is ready to use.** and press **Finish setup**.

Beam then asks you to **Set up your business**: its name and the **time zone for due dates**. Every due date in Beam is a time in a named time zone, so a deadline of 5:00 pm means 5:00 pm where your team works. You can change both later under **Business settings**.

US time zones are listed first, and daylight saving time is applied for you. **Business settings** also shows **Provider costs (USD)**: Beam itself charges nothing, its automation may not spend (its ceiling is USD 0.00), and your mail provider bills your own account. To give contractors or W-2 staff different training, add a **Worker type** field to the directory and select people by it with an audience under **Automation**; Beam never changes anyone's worker type, pay or eligibility.

## Try each role

While `rer dev` is running, open Beam as one of four example staff members, each a real local person with their own roles:

```sh
rer dev --as learner    # Sam Lee, new staff
rer dev --as author     # Ana Ruiz, author and learner
rer dev --as reviewer   # Priya Shah, reviewer and learner
rer dev --as manager    # Tom Okafor, manager, assessor and learner
```

Each prints a fresh link for that person. Running locally, Beam sends no email: invitations and sign-in links answer as sent and nothing leaves your computer.

## Stop and start again

Stop Beam with Ctrl-C or `rer dev --stop`. Your data stays in the folder; the next `rer dev` picks up where you left off.

## Where to go next

- [People, roles and teams](/docs/people): invite your staff.
- [Sources and courses](/docs/courses): turn your first procedure into a course.
- [Move in from TalentLMS](/docs/move-in): bring your existing records across.
