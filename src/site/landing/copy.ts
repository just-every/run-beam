// The landing page's words, exactly as approved. Every claim is backed by Beam's code
// and contract; nothing here names a price, a provider or a number Beam cannot show.
export const meta = { title: 'Beam — Your team, on the same page.' }

export const hero = {
  headline: 'Your team, on the same page.',
  subhead: 'Turn your procedures into courses, and see who has completed the latest version.',
  alternatives: ['TalentLMS', 'Trainual', '360Learning'],
  action: 'Run Beam',
  docs: 'Read the docs',
  small: 'Free and open source, MIT licensed.',
  drawingLabel: '1. Front desk handbook, version 3: Disarm the alarm, then check the fridge log. 2. Opening the clinic, revision 3, Front desk, due 29 Oct. 3. Sam Lee completed revision 3, with a certificate.',
}

export const sections = {
  free: { eyebrow: 'Free', heading: '100% free. Yours to keep.', body: 'Free as in cost, and free as in code. Run it on your own computer and change whatever you like.' },
  changes: { eyebrow: 'Changes', heading: 'When a procedure changes, so does the training.', body: 'A new version of a source flags every course that cites the old one. Publish the update and move the people who need it.' },
  quizzes: { eyebrow: 'Quizzes', heading: 'Quizzes with one right answer.', body: 'A question scores only when exactly the right choices are picked. Practical work goes to the assessor you name.' },
  records: { eyebrow: 'Records', heading: 'See who completed what.', body: 'Every completion names the exact revision it was made against, with a numbered certificate and a report you can download.' },
  agent: { eyebrow: 'Agent work', heading: 'Your agent drafts. You decide.', body: 'Your own agent can prepare course drafts, assignment plans and reminders. Nothing reaches staff until you approve it.' },
  moveIn: { eyebrow: 'Moving in', heading: 'Try it beside what you have.', body: 'Bring your TalentLMS course list and reports across as history. Preview first; undo if you change your mind.' },
}

export const included = {
  eyebrow: 'Also included',
  heading: 'The details, handled.',
  tiles: [
    { icon: 'paths', title: 'Role paths', body: 'A team’s courses in order, with prerequisites and renewals.' },
    { icon: 'laptop', title: 'Pick up anywhere', body: 'Learners resume at the next lesson on any device.' },
    { icon: 'cloud', title: 'Offline training', body: 'Record instructor-led sessions against the right revision.' },
    { icon: 'play', title: 'Practice scenarios', body: 'Unscored situations staff can try again and again.' },
    { icon: 'document', title: 'Questions for staff', body: 'Optional, and answers come back without names.' },
    { icon: 'download', title: 'Export everything', body: 'Every record and file in one archive you keep.' },
  ],
} as const

export const closing = { heading: 'Teach it once. Keep it current.', body: 'Training for your own procedures, run by you.' }
export const footer = { line: 'Training for your own procedures.', licence: 'MIT licence' }
