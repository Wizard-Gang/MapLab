import {readFileSync,realpathSync,cpSync,mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {importRig} from '../src/library/riglab';
import {digest} from '../src/riglab/bundle';
import type {RigPresentationBinding} from '../src/contracts/gameplay-types';
import type {MapDocument} from '../src/contracts/document-types';
import type {Asset} from '../src/contracts/common-types';
export const rigFixture=(p:string):Buffer=>readFileSync(join(import.meta.dirname,'../conformance/riglab',p));
export const jsonFixture=<T>(p:string):T=>JSON.parse(rigFixture(p).toString());
export const rigFiles=():Map<string,Uint8Array>=>{
 const manifest=jsonFixture<any>('bundle/manifest.json');return new Map(['manifest.json',manifest.rig.file,...manifest.animations.map((e:any)=>e.file),...manifest.baked.map((e:any)=>e.file)].map(p=>[p,rigFixture('bundle/'+p)]));
};
export const binding=():RigPresentationBinding=>jsonFixture('binding.json');
export const armor=():Asset=>jsonFixture('asset.json');
export const boundMap=():MapDocument=>jsonFixture('bound.map.json');
export function libraryFixture():{dir:string;label:string;placeholder:false} {
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'maplab-riglab-'));cpSync(join(import.meta.dirname,'../placeholder-library'),dir,{recursive:true});
 const folder={dir,label:'Owned RigLab proof',placeholder:false as const};importRig(folder,{base64:rigFixture('owned-rig.zip').toString('base64')});
 const map=boundMap(),bytes=rigFixture('bound.map.json'),path='maps/riglab-proof.map.json';writeFileSync(join(dir,path),bytes);
 const indexPath=join(dir,'maplab.project.json'),index=JSON.parse(readFileSync(indexPath,'utf8'));index.documents.push({id:map.id,kind:'map',path,sha256:digest(bytes)});writeFileSync(indexPath,JSON.stringify(index));
 const asset=armor();mkdirSync(dirname(join(dir,asset.path)),{recursive:true});writeFileSync(join(dir,asset.path),rigFixture('armor.svg'));return folder;
}
