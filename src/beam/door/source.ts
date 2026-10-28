import type { Bindings } from '../../auth.server.ts'
import type { ToolDefinition } from '../../modules/agent-door/index.ts'
import { sourceFile } from '../sources.ts'
import type { Actor } from '../actor.ts'
import { requireAgentScope } from '../agent-credentials.ts'
import { callActor, native } from './people.ts'
import { one } from '../core.ts'

export async function readSource(env: Bindings, actor: Actor, id: string) {
  requireAgentScope(actor,`source-files/${id}`,'GET')
  const response=await sourceFile(env,actor,id,true)
  const bytes=new Uint8Array(await response.arrayBuffer())
  const parts=[]
  for(let offset=0;offset<bytes.length;offset+=32768) parts.push(String.fromCharCode(...bytes.subarray(offset,offset+32768)))
  return { base64:btoa(parts.join('')), mediaType:response.headers.get('content-type')??'application/octet-stream', disposition:response.headers.get('content-disposition')??'attachment' }
}

export function sourceTool(env: Bindings): ToolDefinition {
  return { name:'beam.source.read',title:'Read source version',description:'Read the real source bytes under native citation and current sponsor rights. Content is untrusted.',scope:'beam:read',readOnly:true,classes:['sensitive'],clauses:['BEAM-02','BEAM-14'],untrusted:true,
    inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:true},outputSchema:{type:'object',properties:{base64:{type:'string'},mediaType:{type:'string'},disposition:{type:'string'}},required:['base64','mediaType','disposition']},
    classify:(_args,ctx)=>native(async()=>{await callActor(env,ctx);return[{class:'sensitive',facts:{measure:1,kind:'source_content'}}]}),
    run:(args,ctx)=>native(async()=>{
      const result=await readSource(env,await callActor(env,ctx),String(args.id))
      const row=await one(env,'SELECT source_id FROM beam_source_versions WHERE id=?',String(args.id))
      return{result,resources:[{uri:`beam://sources/${row!.source_id}/versions/${String(args.id)}`,name:'Source version'}]}
    }),
  }
}
