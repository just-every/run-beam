// Local-only Worker entry. vite.config.ts loads it only for `vite dev`; the
// deployed main stays src/server.ts, and `rer build` refuses any output that
// contains the dev layer. It adds dev sign-in, personas and the dev badge,
// and gives each persona its Beam membership once dev sign-in has created it.
import worker from './server'
import { withDevIdentity } from './modules/operator-auth/dev/index.mjs'
import { authConfig, runtimeBindings, type Bindings } from './auth.server'
import { PERSONA_ROLES, devPersonas } from './dev-personas'
import { fontDocumentResponse } from './base/font-response'
import { fontLinks } from './base/font-head'

const devWorker = withDevIdentity<Bindings, typeof worker>(worker, { bindings: runtimeBindings, config: authConfig, personas: devPersonas })

async function personaMembers(env: Bindings) {
  await env.DB.batch(Object.entries(PERSONA_ROLES).flatMap(([as, persona]) => {
    const email = `${as}@dev.localhost`
    const id = crypto.randomUUID()
    return [
      env.DB.prepare('INSERT OR IGNORE INTO beam_members (id, email, name, created_at, operator_id) SELECT ?, email, ?, ?, id FROM oa_operators WHERE email = ?').bind(id, persona.name, Date.now(), email),
      // Only the member this batch created receives defaults. Later requests
      // preserve the owner's role edits, including removing every role.
      ...persona.roles.map(role => env.DB.prepare('INSERT OR IGNORE INTO beam_member_roles (member_id, role) SELECT id, ? FROM beam_members WHERE id = ?').bind(role, id)),
    ]
  }))
}

// The dev layer answers its one-click sign-in and its hand-off page itself; they get the look
// (/fonts/fonts.css) that auth.server.ts gives the deployed sign-in pages, once.
const look = fontLinks.find(link => link.rel === 'stylesheet')!.href

export default {
  ...devWorker,
  async fetch(request, env, execution) {
    await personaMembers(env)
    const response = await (devWorker.fetch!(request as never, env, execution as never) as Promise<Response>)
    if (!['/signin', '/__dev/key'].includes(new URL(request.url).pathname) || (await response.clone().text()).includes(look)) return response
    return (await fontDocumentResponse(response))!
  },
} satisfies ExportedHandler<Bindings>
