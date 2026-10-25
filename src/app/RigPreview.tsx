import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import type {Asset} from '../contracts/common-types';
import type {RigPresentationBinding} from '../contracts/gameplay-types';
import {readRigBundle} from '../library/client';
import type {RigView} from '../riglab/model';
import {samplePresentation,type PresentationInput,type RigSample} from '../riglab/presentation';
import {DecodedImages} from '../render/assets';
export function useRigBundle(path:string|undefined):{bundle:RigView|null;notice:string} {
 const [state,setState]=useState<{bundle:RigView|null;notice:string}>({bundle:null,notice:'No bundle selected'});
 useEffect(()=>{let active=true;setState({bundle:null,notice:'Loading optional presentation'});if(path)void readRigBundle(path).then(r=>{if(active)setState(r.ok?{bundle:r.bundle,notice:'Verified RigLab bundle'}:{bundle:null,notice:r.message});});else setState({bundle:null,notice:'Generic actor; no bundle'});return()=>{active=false;};},[path]);return state;
}
export function RigPreview({bundle,binding,assets,input}:{readonly bundle:RigView|null;readonly binding:RigPresentationBinding;readonly assets:readonly Asset[];readonly input:PresentationInput}):ReactNode {
 const canvas=useRef<HTMLCanvasElement>(null),images=useRef<DecodedImages|null>(null);const [epoch,setEpoch]=useState(0),[notice,setNotice]=useState('');
 const sample=useMemo(():RigSample=>{try{return samplePresentation(bundle,binding,assets,input);}catch(e){return{status:'placeholder',reason:String(e),frame:null,parts:[]};}},[bundle,binding,assets,input]);
 useEffect(()=>{const cache=new DecodedImages(()=>setEpoch(e=>e+1),setNotice);images.current=cache;setEpoch(e=>e+1);return()=>{images.current=null;cache.dispose();};},[]);
 useEffect(()=>{const ctx=canvas.current?.getContext('2d'),cache=images.current;if(!ctx||!cache)return;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,320,240);ctx.setTransform(2,0,0,2,160-input.foot[0]*2,210-input.foot[1]*2);
  cache.beginFrame();for(const part of sample.parts){const image=cache.get(part.asset,2*Math.max(Math.hypot(part.matrix[0],part.matrix[1]),Math.hypot(part.matrix[2],part.matrix[3]))/part.asset.wuPerAssetUnit);if(image){ctx.save();ctx.transform(...part.matrix);ctx.drawImage(image.source,0,0,part.asset.size[0],part.asset.size[1]);ctx.restore();}}cache.endFrame();
  ctx.strokeStyle=sample.status==='placeholder'?'#efb369':'#83bc9f';ctx.lineWidth=0.5;ctx.strokeRect(input.foot[0]-4,input.foot[1]-16,8,16);ctx.beginPath();ctx.moveTo(input.foot[0]-8,input.foot[1]);ctx.lineTo(input.foot[0]+8,input.foot[1]);ctx.stroke();
 },[sample,input,epoch]);
 return <figure><canvas ref={canvas} width={320} height={240} aria-label="RigLab presentation preview" style={{background:'#16251f',maxWidth:'100%'}}/><figcaption><output aria-label="RigLab preview status">{sample.status} · {sample.reason}{sample.frame===null?'':` · frame ${sample.frame}`}</output>{notice&&<p>{notice}</p>}</figcaption></figure>;
}
