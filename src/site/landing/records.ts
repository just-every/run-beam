// The one month at Sierra Lakes Produce the homepage follows (desk STRUCTURE.md, "Records that must agree across
// screens"). Every section reads its figures from here, so the same record shows the same numbers wherever it appears.
export const company = {
  name: 'Sierra Lakes Produce',
  people: 131,
  sites: [
    { name: 'Fresno, CA', people: 79 },
    { name: 'Joliet, IL', people: 40 },
    { name: 'Chicago, IL', people: 12 },
  ],
  ca: 79,
  il: 52,
} as const

export const rafael = { name: 'Rafael Medina', initials: 'RM', id: '6082', username: 'rmedina', role: 'Warehouse Associate', site: 'Fresno', city: 'Fresno, CA' } as const

export const sync = { downloaded: '6:20 am', offline: '7:10 – 9:12 am', synced: '9:12 am', revision: 4, queued: 7, lessons: 6, quiz: '9/10' } as const

export const practical = { assessor: 'Maria Chen', booked: '10:00 am', passed: '10:40 am', items: 8, certificate: 'SLP-0418', completed: 'Tue Oct 20, 2026', renews: 'Oct 20, 2029', written: '10:41 am', hours: '2.5', writtenBack: 212 } as const

export const dp7 = { staff: 38, finished: 31, midCourse: 7, english: 22, spanish: 16, approved: 'Mon Oct 19 · 4:10 pm', done: 'Fri Oct 23', measuring: 'Fri Nov 20' } as const

export const moveIn = { export: 'Tue Sep 22', cutover: 'Tue Sep 29, 6:00 am PT', active: 130, former: 22, completions: '2,406', pdfs: '1,118', drafts: 26, scorm12: 13, scorm2004: 2, shadow: '1,027', credited: 47, supervisorsExcluded: 9, oldExcluded: 3 } as const

/** The six requirements on the Mon Nov 2 report: required, current, open, overdue. */
export const requirements = [
  { name: 'Lift-truck evaluation · 3 yr', required: 58, current: 58, open: 0 },
  { name: 'Ammonia awareness · Fresno', required: 79, current: 79, open: 0 },
  { name: 'Dock procedure DP-7 rev 6 · Joliet', required: 38, current: 38, open: 0 },
  { name: 'CA harassment · non-supervisor', note: `${moveIn.credited} credited from TalentLMS history`, required: 70, current: 68, open: 2 },
  { name: 'CA harassment · supervisor, 2 hr', required: 9, current: 7, open: 2 },
  { name: 'IL harassment · annual', note: 'assigned Mon Nov 2 · due Dec 31', required: 52, current: 0, open: 52 },
] as const
