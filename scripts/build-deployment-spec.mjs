import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {deploymentSpec} from './delivery/base/spec.mjs';
const root=process.cwd();
const config=JSON.parse(await readFile(resolve(root,'packaging.json'),'utf8'));
const bytes=JSON.stringify(await deploymentSpec(root,config.artifact.specInputs),null,2)+'\n';
const target=resolve(root,'management/integration/deployment-spec.json');
if(process.argv.includes('--check')) {
  if(await readFile(target,'utf8')!==bytes) throw Error('Deployment specification is stale. Run pnpm delivery:spec after a real build.');
  console.log('Deployment specification matches the real build and source policy.');
} else {
  await mkdir(dirname(target),{recursive:true});
  await writeFile(target,bytes);
  console.log('Wrote management/integration/deployment-spec.json');
}
