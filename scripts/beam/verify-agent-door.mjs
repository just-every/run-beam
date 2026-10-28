// Temporary bridge until the owner-lifecycle hooks in Base d555e789 are
// available in the published CLI. Called by normal rer verify, without
// changing its exit status or any existing verification targets.
import { mkdtemp, open, rm, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

const pin='d555e789cffb744a9f83d76ebe42a2e3bdd7a055'
const run=(command,args,options={})=>new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:'inherit',...options})
  child.on('error',reject)
  child.on('exit',(code,signal)=>code===0?resolve():reject(new Error(`${command} exited ${code??signal}`)))
})
let temporary
try {
  let source=process.env.BEAM_AGENT_BASE_ARCHIVE
  if(!source) {
    temporary=await mkdtemp(join(tmpdir(),'beam-agent-base-'))
    const archive=join(temporary,'base.tgz')
    const file=await open(archive,'w',0o600)
    try { await run('gh',['api',`repos/runeditrun/base/tarball/${pin}`],{stdio:['ignore',file.fd,'inherit']}) } finally { await file.close() }
    await run('tar',['-xzf',archive,'--strip-components=1','-C',temporary])
    source=temporary
  }
  const runner=resolve(source,'cli/agent-door.mjs')
  await access(runner)
  console.log(`Agent door runtime and conformance pin: ${pin} (unreleased)`)
  await run(process.execPath,[runner,process.cwd()])
} catch(error) {
  console.error(`Agent door verification failed: ${error.message}`)
  process.exitCode=1
} finally { if(temporary) await rm(temporary,{recursive:true,force:true}) }
