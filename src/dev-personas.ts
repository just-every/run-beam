import type { DevPersona } from './modules/operator-auth/dev/index.mjs'
import type { Role } from './beam/actor'

// Local dev personas: real operators at <as>@dev.localhost, created only by
// local dev sign-in and suspended in exports. Only src/server.dev.ts uses them.
// Each one is a Beam member with the learning roles of a typical small team.
export const PERSONA_ROLES: Record<string, { name: string; roles: Role[] }> = {
  author: { name: 'Ana Ruiz (author)', roles: ['author', 'learner'] },
  reviewer: { name: 'Priya Shah (reviewer)', roles: ['reviewer', 'learner'] },
  manager: { name: 'Tom Okafor (manager and assessor)', roles: ['manager', 'assessor', 'learner'] },
  learner: { name: 'Sam Lee (new staff)', roles: ['learner'] },
}

export function devPersonas(): DevPersona[] {
  return Object.entries(PERSONA_ROLES).map(([as, persona]) => ({ as, role: 'member', displayName: persona.name }))
}
