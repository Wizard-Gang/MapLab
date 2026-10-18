import { expect, test, type Page } from '@playwright/test';
import { command, libraryFile, openEditor, openMap, resetLibrary } from './support';
const canvas=(p:Page)=>p.getByRole('group',{name:'World canvas',exact:true});
const notice=(p:Page)=>p.getByLabel('Edit notice',{exact:true});
const prop=(p:Page,name:string)=>p.getByRole('spinbutton',{name:`Property ${name}`,exact:true});
const choose=async(p:Page,id:string)=>{await p.getByRole('searchbox',{name:'Hierarchy search'}).fill(id);await p.getByRole('button',{name:`Select ${id}`,exact:true}).click();};
const ready=async(p:Page)=>{await openEditor(p);await openMap(p,'map.forest');await p.getByLabel('Pick mode',{exact:true}).selectOption('Platforms');};
async function at(p:Page,x:number,y:number){await canvas(p).scrollIntoViewIfNeeded();const d=await canvas(p).evaluate(el=>({...((el as HTMLElement).dataset)}));const b=(await canvas(p).boundingBox())!;return{x:b.x+(x-Number(d.cameraX))*Number(d.zoom),y:b.y+(y-Number(d.cameraY))*Number(d.zoom),z:Number(d.zoom)};}
async function drag(p:Page,x:number,y:number,dx=32,dy=0){const pt=await at(p,x,y);await p.mouse.move(pt.x,pt.y);await p.mouse.down();await p.mouse.move(pt.x+dx*pt.z,pt.y+dy*pt.z,{steps:6});}
test.beforeEach(async({page})=>{resetLibrary();await page.addInitScript(()=>document.addEventListener('pointerdown',e=>{const el=(e.target as Element).closest('[aria-label="World canvas"]');if(el)(el as HTMLElement).dataset.testPointer=String(e.pointerId);},true));});

test('foothold endpoint release creates one undo and saved source; art remains visible independently',async({page})=>{
  await ready(page);await choose(page,'fh.right');const original=libraryFile('maps/forest.map.json');
  await drag(page,896,352);await expect(canvas(page)).toHaveAttribute('data-handle-preview','928,352');expect(libraryFile('maps/forest.map.json')).toEqual(original);await page.mouse.up();
  await expect(notice(page)).toHaveText('Move physical handle');await expect(prop(page,'b.0')).toHaveValue('928');
  await command(page,'Undo').click();await expect(prop(page,'b.0')).toHaveValue('896');await expect(command(page,'Undo')).toBeDisabled();
  await command(page,'Redo').click();await command(page,'Save').click();await expect(page.getByRole('status')).toContainText('Saved');
  expect(JSON.parse(libraryFile('maps/forest.map.json').toString()).footholds.find((f:any)=>f.id==='fh.right').b).toEqual([928,352]);
  await page.getByText('Overlays and snap',{exact:true}).click();const art=page.getByLabel('Art canvas',{exact:true});const bytes=await art.evaluate(el=>(el as HTMLCanvasElement).toDataURL());
  await page.getByRole('checkbox',{name:'Collision',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Footholds',exact:true}).uncheck();expect(await art.evaluate(el=>(el as HTMLCanvasElement).toDataURL())).toBe(bytes);
  await page.getByRole('checkbox',{name:'Collision',exact:true}).check();expect(await art.evaluate(el=>(el as HTMLCanvasElement).toDataURL())).toBe(bytes);
});

test('Escape, pointercancel, lost capture, focus and resize discard physical previews',async({page})=>{
  await ready(page);await choose(page,'fh.right');const original=libraryFile('maps/forest.map.json');
  for(const kind of ['Escape','pointercancel','lostpointercapture','focus','resize']){
    await drag(page,896,352);await expect(canvas(page)).toHaveAttribute('data-handle-preview','928,352');
    if(kind==='Escape') {
      await canvas(page).evaluate(el=>el.dispatchEvent(new PointerEvent('pointermove',{pointerId:9999,clientX:0,clientY:0,bubbles:true})));
      await expect(canvas(page)).toHaveAttribute('data-handle-preview','928,352');
      await page.keyboard.press('Escape');
    }
    else if(kind==='focus')await page.getByRole('searchbox',{name:'Hierarchy search'}).focus();
    else if(kind==='resize')await page.setViewportSize({width:1100,height:800});
    else await canvas(page).evaluate((el,type)=>el.dispatchEvent(new PointerEvent(type,{pointerId:Number((el as HTMLElement).dataset.testPointer),bubbles:true})),kind);
    await expect(canvas(page)).toHaveAttribute('data-handle-preview','');await page.mouse.up();await expect(command(page,'Undo')).toBeDisabled();await expect(prop(page,'b.0')).toHaveValue('896');
  }expect(libraryFile('maps/forest.map.json')).toEqual(original);
});

test('split, join retaining right ID, nested references and save survive undo',async({page})=>{
  await ready(page);await choose(page,'fh.west');await page.getByRole('button',{name:'Split foothold',exact:true}).click();await expect(notice(page)).toHaveText('Split foothold');
  await expect(prop(page,'b.0')).toHaveValue('240');await choose(page,'fh.west-2');await page.getByLabel('Target foothold',{exact:true}).selectOption('fh.west');
  await page.getByRole('button',{name:'Join retaining selected ID'}).click();await expect(notice(page)).toHaveText('Join footholds');await expect(prop(page,'a.0')).toHaveValue('0');await expect(prop(page,'b.0')).toHaveValue('480');
  await command(page,'Save').click();await expect(page.getByRole('status')).toContainText('Saved');const saved=JSON.parse(libraryFile('maps/forest.map.json').toString());
  expect(saved.footholds.some((f:any)=>f.id==='fh.west')).toBe(false);expect(saved.entities.find((e:any)=>e.id==='start.player').anchor).toEqual({kind:'surface',footholdId:'fh.west-2',u:0.125,normalOffset:0});
  await command(page,'Undo').click();await command(page,'Undo').click();await expect(command(page,'Undo')).toBeDisabled();await choose(page,'fh.west');await expect(prop(page,'b.0')).toHaveValue('480');
});

test('welded solid seam and collider vertices update physical authority with stable IDs',async({page})=>{
  await ready(page);await choose(page,'fh.slope');await drag(page,800,640,0,-32);await page.mouse.up();await expect(notice(page)).toHaveText('Move physical handle');await expect(prop(page,'a.1')).toHaveValue('608');
  await choose(page,'fh.east');await expect(prop(page,'b.1')).toHaveValue('608');await command(page,'Undo').click();await expect(command(page,'Undo')).toBeDisabled();
  await page.getByLabel('Pick mode',{exact:true}).selectOption('Collision');await choose(page,'body.west');await drag(page,480,800,32,0);await page.mouse.up();await expect(notice(page)).toHaveText('Edit collider shape');await expect(prop(page,'shapes.0.points.2.0')).toHaveValue('512');
  await command(page,'Undo').click();await expect(prop(page,'shapes.0.rect.2')).toHaveValue('480');await expect(command(page,'Undo')).toBeDisabled();
});

test('mismatched solid/one-way connect and owner edges refuse explicitly without history',async({page})=>{
  await ready(page);await choose(page,'fh.east');
  await page.getByRole('button',{name:'Make one-way',exact:true}).click();await expect(notice(page)).toContainText('Solid and one-way');await expect(command(page,'Undo')).toBeDisabled();
  await page.getByLabel('Target foothold',{exact:true}).selectOption('fh.upper');await page.getByRole('button',{name:'Snap and connect',exact:true}).click();await expect(notice(page)).toContainText('Incompatible');await expect(command(page,'Undo')).toBeDisabled();
  await choose(page,'fh.upper');await page.getByLabel('Solid owner edge',{exact:true}).selectOption({label:'body.west / shape.west / 0'});await page.getByRole('button',{name:'Assign solid edge',exact:true}).click();await expect(notice(page)).toContainText('refused');await expect(command(page,'Undo')).toBeDisabled();
  await choose(page,'fh.east');await page.getByRole('button',{name:'Disconnect endpoint',exact:true}).click();await expect(notice(page)).toHaveText('Disconnect foothold endpoint');
  await page.getByLabel('Target foothold',{exact:true}).selectOption('fh.slope');await page.getByRole('button',{name:'Snap and connect',exact:true}).click();await expect(notice(page)).toHaveText('Snap and connect footholds');
  await command(page,'Undo').click();await command(page,'Undo').click();await expect(command(page,'Undo')).toBeDisabled();
});
