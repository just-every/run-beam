// Conformance fixture only: every person and learning record enters through
// the actual owner, roster, password, authoring and review HTTP lifecycle.
export default async function initialize(input) {
  try { return await nativeInitialize(input) } catch(error) { console.error("Native conformance fixture:",error.message); throw error }
}
async function nativeInitialize({request,origin,email,claim,returnTo}) {
  const bootstrap = await request(origin+claim.path,{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:claim.token,displayName:'Morgan Ellis',returnTo})})
  if (bootstrap.status!==303) throw new Error(`Owner claim HTTP ${bootstrap.status}`)
  const cookie=bootstrap.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ')
  const setup=await request(origin+'/setup',{method:'POST',redirect:'manual',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({confirm:'yes'}).toString()})
  if(setup.status!==303) throw new Error(`Native first-run confirmation HTTP ${setup.status}`)
  await setup.body?.cancel()
  const api=async (action,data,session=cookie) => {
    const response=await request(`${origin}/api/beam/${action}`,{method:data?'POST':'GET',headers:{Origin:origin,Cookie:session,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})})
    const result=await response.json()
    if (!response.ok) throw new Error(`${action} HTTP ${response.status}: ${result.error??result.code}`)
    return result
  }
  const owner=await api('me')
  await api('business.configure',{name:'Sierra Lakes Produce',timezone:'UTC'})
  const csv='Employee ID,Name,Role\nRER-REVIEW,Avery Chen,Reviewer\nRER-P1,Bea Santos,Packing\nRER-P2,Cory Patel,Packing\nRER-P3,Dara Okafor,Packing'
  const roster=await api('people.import',{file:{filename:'staff.csv',base64:Buffer.from(csv).toString('base64'),type:'text/csv'}})
  const reviewer=roster.created[0]
  await api('person.roles',{member:reviewer,roles:['learner','reviewer','manager']})
  await api('frontline.policy',{enabled:true})
  const credential=await api('frontline.issue',{member:reviewer,username:'avery.chen',mode:'password'})
  const signed=await request(origin+'/auth/frontline',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:credential.username,secret:credential.initialSecret,newPassword:'Synthetic packing reviewer passphrase 2026'})})
  if (!signed.ok) throw new Error(`Native reviewer sign-in HTTP ${signed.status}`)
  const reviewerCookie=signed.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ')
  await signed.body?.cancel()
  const source=await api('source.create',{title:'Packing procedure',reviewer,licence:'owned',licenceEvidence:'Employer-authored packing procedure',provenance:'Packing station SOP',file:{filename:'packing.txt',base64:Buffer.from('Apply the label before moving the crate.').toString('base64'),type:'text/plain'}})
  const course=await api('course.create',{title:'A Packing procedure',summary:'Safe packing and label checks',reviewer})
  const lesson=await api('course.lesson',{course:course.id,draftVersion:1,title:'Label the crate',body:'Apply the label before moving the crate.',sources:[source.versionId]})
  const revision=await api('course.submit',{course:course.id,draftVersion:lesson.draftVersion})
  const published=await request(origin+'/app/do/revision.decide',{method:'POST',redirect:'manual',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({revision:revision.id,decision:'publish',returnTo:'/app/courses'}).toString()})
  if (published.status!==303 || published.headers.get('location')?.includes('error=')) throw new Error('Native reviewer publication refused')
  await published.body?.cancel()
  await api('source.version',{source:source.id,licence:'owned',licenceEvidence:'Employer-authored update',provenance:'Reviewed packing update',file:{filename:'packing-v2.txt',base64:Buffer.from('Apply the label and close the lid before moving the crate.').toString('base64'),type:'text/plain'}})
  const imported=await api('outcome.import',{purpose:'diagnosis',course:course.id,jobRole:'Packing',metric:'Labels missed',unit:'per 100 crates',from:'2030-02-01',to:'2030-02-28',csv:'Employee ID,Date,Value\nRER-P1,2030-02-01,1\nRER-P2,2030-02-01,2\nRER-P3,2030-02-01,3'})
  const diagnosis=await api('diagnosis.prepare',{import:imported.id})
  await api('diagnosis.review',{diagnosis:diagnosis.id},reviewerCookie)
  const questions=await api('agent.propose',{kind:'question_plan',title:'Packing clarity',reasons:['Ask voluntary questions before choosing an intervention.'],payload:{title:'Packing clarity',purpose:'Find unclear instructions',questions:['Is the label procedure usable?'],participants:roster.created.slice(1),closesOn:'2031-01-01'}})
  await api('agent.decide',{proposal:questions.id,decision:'approve',sha256:questions.sha256})
  return bootstrap
}
