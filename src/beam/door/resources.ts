import type { Bindings } from '../../auth.server.ts'
import type { ResourceDefinition } from '../../modules/agent-door/index.ts'
import { route } from '../views.ts'
import { nativeActor } from './people.ts'
import { requireAgentScope } from '../agent-credentials.ts'
import { readSource } from './source.ts'
import { one } from '../core.ts'

/** Read with the same services and current role checks as the JSON view. */
export function beamResources(env: Bindings): ResourceDefinition[] {
  return [
    ['beam://courses/{id}', 'courses'], ['beam://courses/{id}/revisions/{revision}', 'revisions'],
    ['beam://proposals/{id}', 'proposals'], ['beam://questions/{id}', 'questions'],
    ['beam://sources/{id}/versions/{version}', 'source-files'],
  ].map(([uriTemplate,area]) => ({
    uriTemplate, name: `Beam ${area}`, description: 'Private native learning record. Imported and external text is untrusted.', scope: 'beam:read', mimeType: 'application/json', classes: ['sensitive'],
    classify: record => [{ class: 'sensitive', facts: { measure: Array.isArray(record.json) ? record.json.length : 1, kind: 'private_learning' } }],
    async read(uri,ctx) {
      try {
        const parts = uri.slice('beam://'.length).split('/')
        const actor = await nativeActor(env,ctx.person)
        if(area==='source-files') {
          const version=await one(env,'SELECT source_id FROM beam_source_versions WHERE id=?',decodeURIComponent(parts[3]))
          if(version?.source_id!==decodeURIComponent(parts[1])) return null
          return {json:await readSource(env,actor,decodeURIComponent(parts[3])),untrusted:true}
        }
        const id = decodeURIComponent(area === 'revisions' ? parts[3] : parts[1])
        const path = `${area}/${id}`
        requireAgentScope(actor,path,'GET')
        const { view, id: nativeId } = route(path)
        const json = await view(env,actor,new Request(`${env.AUTH_ORIGIN}/api/beam/${path}`),nativeId)
        if (area === 'revisions' && (json as { revision?: { course_id?: string } }).revision?.course_id !== decodeURIComponent(parts[1])) return null
        return { json, untrusted: true }
      } catch { return null }
    },
  }))
}
