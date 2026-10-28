import type {LibraryStore} from '../app/store';
// Native PointerEvents enter the ordinary Viewport handler. Its overlay frame counter changes after drawing.
// The following rAF bounds the rendering opportunity after that draw; raw event/draw/frame times are retained.
export function nativeInput(store:LibraryStore,status:(message:string)=>void):Promise<readonly (readonly {event:number;draw:number;frame:number;latency:number;trusted:boolean;previewCells:number}[])[]>{
  const doc=store.active()!,session=store.terrain(doc.id),selection=store.selection(doc.id);
  const host=document.querySelector<HTMLElement>('[aria-label="World canvas"]')!,overlay=host.querySelector<HTMLCanvasElement>('.overlay-canvas')!;
  selection.mode('Terrain');session.choose({tileId:'tile.grass',quarterTurns:0,mirrorX:false,mirrorY:false});
  const original=store.active()!.state.model;host.scrollIntoView({block:'center'});
  return new Promise((resolve,reject)=>{
    let run=-1,active=false,pending:number[]=[],current:{event:number;draw:number;frame:number;latency:number;trusted:boolean;previewCells:number}[]=[];
    const runs:typeof current[]=[];
    const stop=()=>{clearTimeout(timer);observer.disconnect();host.removeEventListener('pointerdown',down,true);host.removeEventListener('pointermove',move,true);host.removeEventListener('pointerup',up,true);host.removeEventListener('pointercancel',cancel,true);session.cancel();};
    const fail=(error:string)=>{stop();reject(Error(error));};
    const observer=new MutationObserver(()=>{
      const events=pending.splice(0),draw=performance.now(),previewCells=Number(overlay.dataset.previewCells??0);
      if(!events.length||!previewCells)return;
      requestAnimationFrame(frame=>{for(const event of events)current.push({event,draw,frame,latency:frame-event,trusted:true,previewCells});});
    });
    observer.observe(overlay,{attributes:true,attributeFilter:['data-frames']});
    const down=(event:PointerEvent)=>{
      if(!event.isTrusted||event.button!==0||active)return;
      run++;active=true;pending=[event.timeStamp];current=[];
      status(`Native brush gesture ${run===0?'warm-up':`${run}/5`}: drag across the canvas. Escape cancels.`);
    };
    const move=(event:PointerEvent)=>{if(active&&event.isTrusted&&event.buttons===1)pending.push(event.timeStamp);};
    const up=()=>{
      if(!active)return;active=false;
      // Preserve the fixture: this benchmark measures transient feedback, then uses ordinary gesture cancellation.
      session.cancel();
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if(store.active()!.state.model!==original)return fail('Native preview changed the document identity');
        if(current.length<2)return fail('Native gesture produced too few visible preview frames');
        if(run>0)runs.push(current);
        if(runs.length===5){stop();resolve(runs);}
        else status(`Ready for native brush ${run===0?'1':run+1}/5. Drag across the visible canvas.`);
      }));
    };
    const cancel=()=>fail('Native pointer was cancelled');
    host.addEventListener('pointerdown',down,true);host.addEventListener('pointermove',move,true);host.addEventListener('pointerup',up,true);host.addEventListener('pointercancel',cancel,true);
    const timer=setTimeout(()=>fail('Native input capture timed out'),10*60*1000);
    status('Native brush warm-up ready: drag across the visible canvas, followed by five warm gestures.');
  });
}
