// Dedicated production entry: the ordinary App, source loading, panels, input handlers and renderer.
import { createRoot } from 'react-dom/client';
import { App, store } from '../app/App';
import { runEditorMeasurements } from './editor-run';
import '../app/styles.css';
const status=document.querySelector<HTMLOutputElement>('#measurement-status')!;
const button=document.querySelector<HTMLButtonElement>('#measure')!;
const launch=document.querySelector<HTMLButtonElement>('#launch')!;
launch.onclick=()=>window.open('?sized=1','maplab-measurements','popup,width=1440,height=900');
if(location.search.includes('sized=1')){
  window.resizeBy(1440-innerWidth,900-innerHeight);
  launch.hidden=true;button.hidden=false;
  createRoot(document.querySelector('#root')!).render(<App/>);
}
button.onclick=async()=>{
  button.disabled=true;
  try {
    if(!store.active())await store.open('map.performance');
    const report=await runEditorMeasurements(store,message=>{status.textContent=message;});
    const reply=await fetch('/measurement/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
    if(!reply.ok)throw Error(await reply.text());
    status.textContent='Measurements captured. '+JSON.stringify(report.summary);
  } catch(error) {
    status.textContent=String(error);
    await fetch('/measurement/abort',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({error:String(error),viewport:[innerWidth,innerHeight],dpr:devicePixelRatio})});
  }
  finally {button.disabled=false;}
};
status.textContent='Production editor ready. Open the owned performance map, then measure.';
