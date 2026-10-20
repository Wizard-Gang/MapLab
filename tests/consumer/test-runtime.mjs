// Separate final-byte consumer: no editor, history, storage, DOM, dev server or RigLab.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestSession } from './src/test-runtime/session.js';
const [folder,name]=process.argv.slice(2),read=p=>JSON.parse(readFileSync(join(folder,p),'utf8'));
const input=read(name+'.input.json'),run=new TestSession(read('forest.map.json'),read('player.movement.json'),input.initial);
run.replay(input);
process.stdout.write(JSON.stringify({frames:run.getSnapshot().frames,recording:run.recording()}));
