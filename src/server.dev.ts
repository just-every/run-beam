// Local-only Worker entry. vite.config.ts loads it only for `vite dev`; the
// deployed main stays src/server.ts, and `rer build` refuses any output that
// contains the dev layer. It adds dev sign-in, personas and the dev badge,
// and gives each persona its Beam membership once dev sign-in has created it.
import worker from './server'
import { withDevIdentity } from './modules/operator-auth/dev/index.mjs'
import { authConfig, runtimeBindings, type Bindings } from './auth.server'
import { PERSONA_ROLES, devPersonas } from './dev-personas'

const devWorker = withDevIdentity<Bindings, typeof worker>(worker, { bindings: runtimeBindings, config: authConfig, personas: devPersonas })

async function personaMembers(env: Bindings) {
  await env.DB.batch(Object.entries(PERSONA_ROLES).flatMap(([as, persona]) => {
    const email = `${as}@dev.localhost`
    return [
      env.DB.prepare("INSERT OR IGNORE INTO beam_members (id, email, name, created_at, operator_id) SELECT lower(hex(randomblob(16))), email, ?, ?, id FROM oa_operators WHERE email = ?").bind(persona.name, Date.now(), email),
      ...persona.roles.map(role => env.DB.prepare('INSERT OR IGNORE INTO beam_member_roles (member_id, role) SELECT id, ? FROM beam_members WHERE email = ?').bind(role, email)),
    ]
  }))
}

export default {
  ...devWorker,
  async fetch(request, env, execution) {
    await personaMembers(env)
    return devWorker.fetch!(request as never, env, execution as never) as Promise<Response>
  },
} satisfies ExportedHandler<Bindings>
