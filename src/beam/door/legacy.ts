// Compatibility for issued preparation credentials. This is an HTTP shape
// adapter into the same policy pipeline, with no independent dispatcher.
import type { Bindings } from '../../auth.server.ts'
import type { Actor } from '../actor.ts'
import { delegatedSession } from '../agent-credentials.ts'
import { beamAgentDoor } from './index.ts'
import { beamPeople } from './people.ts'
import { readDeclarations } from './reads.ts'
import definitions from './actions.json'

export async function legacyPreparation(env: Bindings, actor: Actor, path: string, request: Request): Promise<Response> {
  const method=request.method
  const reader=readDeclarations.find(([,native])=>native.includes(':id') ? new RegExp('^'+native.replace(':id','[\\w-]+')+'$').test(path) : native===path)
  const write=method==='POST' ? definitions.find(item=>item.action===path) : null
  const source=method==='GET' && /^source-files\/[\w-]+$/.test(path)
  const name=write?.name ?? (source?'beam.source.read':method==='GET' && reader ? `beam.${reader[0]}` : null)
  if(!name) return Response.json({code:'agent_scope_forbidden',error:'agent_scope_forbidden'},{status:403})
  const person=await beamPeople(env).person(actor.id)
  if(!person?.active) return Response.json({code:'unauthenticated',error:'authentication_required'},{status:401})
  // Reuse native token admission, and retain the original session/expiry in
  // the saved principal so approval execution checks them again.
  await delegatedSession(env,request)
  const part=(request.headers.get('authorization')??'').split('.')[1]
  const claim=JSON.parse(atob(part.replaceAll('-','+').replaceAll('_','/')))
  const args=write ? await request.json() as Record<string,unknown> : Object.fromEntries(new URL(request.url).searchParams)
  if(!args || typeof args!=='object' || Array.isArray(args)) return Response.json({code:'invalid_json',error:'invalid_json'},{status:400})
  if(reader?.[1].includes(':id')) args.id=path.split('/').pop()
  if(source) args.id=path.split('/').pop()
  if(write && args.idempotency_key===undefined) args.idempotency_key=crypto.randomUUID()
  if(write?.action==='course.block.reuse' && typeof args.from==='string') { const [course,lesson,block]=args.from.split(':'); args.from={course,lesson,block} }
  const result=await beamAgentDoor(env).invoke(name,args,{person,agent:{id:`beam-preparation:${actor.sessionId}:${claim.expiresAt}`,name:'Preparation agent'}})
  if(result.outcome==='done') {
    if(source) { const record=result.result as {base64:string;mediaType:string;disposition:string}; return new Response(Uint8Array.from(atob(record.base64),c=>c.charCodeAt(0)),{headers:{'content-type':record.mediaType,'content-disposition':record.disposition}}) }
    return Response.json(result.result)
  }
  const code=result.code??(result.outcome==='pending'?'approval_required':'refused')
  const status=typeof result.fields?.status==='number' ? result.fields.status : result.outcome==='pending'?202:code==='unauthenticated'?401:code==='invalid_arguments'?400:code==='output_invalid'?500:403
  return Response.json({code,error:code,...result.fields,...(result.approval?{approval:result.approval}:{})},{status})
}
