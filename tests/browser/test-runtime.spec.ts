import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { command, libraryFile, nameField, openEditor, openMap, resetLibrary, placeholderUrl } from './support';
import type { Recording } from '../../src/test-runtime/session';
import type { Step } from '../../src/physics-reference';
const folder='conformance/test-runtime/';
const read=<T>(p:string):T=>JSON.parse(readFileSync(folder+p,'utf8')) as T;

test('integrated generic actor: forest walk/jump/climb/drop exact replays preserve source and author undo/redo',async({page})=>{
 resetLibrary();await openEditor(page);await openMap(page,'map.forest');
 const bytes=libraryFile('maps/forest.map.json'),index=libraryFile('maplab.project.json');
 await nameField(page).fill('Author revision before Test');await nameField(page).press('Tab');
 await command(page,'Undo').click();await command(page,'Redo').click();
 await page.getByRole('button',{name:'Start Test snapshot',exact:true}).click();
 await expect(page.getByLabel('Generic debug actor',{exact:true})).toBeVisible();
 const hud=page.getByLabel('Test movement HUD',{exact:true});await expect(hud).toHaveAttribute('data-tick','0');
 await page.getByRole('region',{name:'Integrated Test',exact:true}).screenshot({path:'/private/tmp/ml020-test-panel.png'});
 for(const name of read<{cases:string[]}>('cases.json').cases){
  const input=read<Recording>(name+'.input.json'),expected=read<{frames:Step[]}>(name+'.expected.json');
  await page.getByLabel('Test replay input',{exact:true}).fill(JSON.stringify(input));await page.getByRole('button',{name:'Replay Test',exact:true}).click();
  await expect(page.getByLabel('Test notice',{exact:true})).toHaveText('Replay complete; paused');
  const final=expected.frames.at(-1)!;
  await expect(hud).toHaveAttribute('data-tick',String(final.state.tick));await expect(hud).toHaveAttribute('data-state',final.state.mode);await expect(hud).toHaveAttribute('data-support',final.state.supportId??'');
  await expect(hud).toContainText(`Velocity (${final.state.vx}, ${final.state.vy}) su/tick`);
  expect(JSON.parse(await page.getByLabel('Test contacts',{exact:true}).innerText())).toEqual(final.contacts);
  await page.getByRole('button',{name:'Use recorded input',exact:true}).click();
  expect(JSON.parse(await page.getByLabel('Test replay input',{exact:true}).inputValue())).toEqual(input);
  // Actual panel replay at every intermediate state, including finite-body contact witnesses.
  for(const tick of [1,10,12,13,input.ticks]){
   if(tick>input.ticks)continue;
   await page.getByLabel('Test replay input',{exact:true}).fill(JSON.stringify({...input,ticks:tick,input:input.input.filter(v=>v.fromTick<input.initial.tick+tick)}));
   await page.getByRole('button',{name:'Replay Test',exact:true}).click();
   const frame=expected.frames[tick-1]!;await expect(hud).toHaveAttribute('data-tick',String(frame.state.tick));await expect(hud).toHaveAttribute('data-state',frame.state.mode);
   expect(JSON.parse(await page.getByLabel('Test contacts',{exact:true}).innerText())).toEqual(frame.contacts);
  }
 }
 await page.getByRole('button',{name:'Reset Test',exact:true}).click();await expect(hud).toHaveAttribute('data-tick','0');await expect(hud).toContainText('Foot (60, 640)');
 await page.getByRole('button',{name:'Stop Test',exact:true}).click();
 await expect(nameField(page)).toHaveValue('Author revision before Test');await command(page,'Undo').click();await expect(nameField(page)).toHaveValue('Forest acceptance world');await expect(command(page,'Undo')).toBeDisabled();await command(page,'Redo').click();await expect(nameField(page)).toHaveValue('Author revision before Test');
 expect(libraryFile('maps/forest.map.json')).toEqual(bytes);expect(libraryFile('maplab.project.json')).toEqual(index);
});

test('Test pause/step/keyboard/reset, negative replay, profile switch and authored edit lifecycle',async({page})=>{
 resetLibrary();await openEditor(page);await openMap(page,'map.forest');await page.getByRole('button',{name:'Start Test snapshot',exact:true}).click();
 const hud=page.getByLabel('Test movement HUD',{exact:true}),stage=page.getByRole('application',{name:'Test stage',exact:true});
 await stage.focus();await page.keyboard.down('ArrowRight');await page.keyboard.press('KeyN');await page.keyboard.up('ArrowRight');await expect(hud).toHaveAttribute('data-tick','1');await expect(hud).toContainText('Velocity (64, 0)');
 await page.getByRole('button',{name:'Step Test',exact:true}).click();await expect(hud).toHaveAttribute('data-tick','2');await page.waitForTimeout(80);await expect(hud).toHaveAttribute('data-tick','2');
 await page.getByLabel('Test replay input',{exact:true}).fill('{"bad":true}');await page.getByRole('button',{name:'Replay Test',exact:true}).click();await expect(page.getByLabel('Test notice',{exact:true})).toContainText('Replay refused');await expect(hud).toHaveAttribute('data-tick','2');
 await page.getByRole('button',{name:'Run Test',exact:true}).click();await stage.focus();await page.keyboard.down('ArrowRight');await expect(hud).not.toHaveAttribute('data-tick','2');await page.keyboard.up('ArrowRight');
 await page.getByRole('button',{name:'Pause Test',exact:true}).click();const tick=await hud.getAttribute('data-tick');await page.waitForTimeout(80);await expect(hud).toHaveAttribute('data-tick',tick!);
 await page.getByRole('button',{name:'Reset Test',exact:true}).click();await expect(hud).toContainText('Velocity (0, 0)');
 await page.getByLabel('Test movement profile',{exact:true}).selectOption('movement.flyer');await expect(stage).toHaveCount(0);await page.getByRole('button',{name:'Start Test snapshot',exact:true}).click();await expect(page.getByLabel('Test startup notice',{exact:true})).toContainText('unsupported');
 await page.getByLabel('Test movement profile',{exact:true}).selectOption('movement.player');await page.getByRole('button',{name:'Start Test snapshot',exact:true}).click();
 await nameField(page).fill('Edit stops Test');await nameField(page).press('Tab');await expect(stage).toHaveCount(0);await expect(command(page,'Undo')).toBeEnabled();
});

test('read-only placeholder cannot start a runtime snapshot',async({page})=>{
 await openEditor(page,placeholderUrl);await openMap(page,'map.forest');await page.getByRole('button',{name:'Start Test snapshot',exact:true}).click();await expect(page.getByLabel('Test startup notice',{exact:true})).toContainText('unlocked');await expect(page.getByRole('application',{name:'Test stage'})).toHaveCount(0);
});
