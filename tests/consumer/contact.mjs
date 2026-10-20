// A separate process, with no editor, storage, DOM or dev server. Consumes final fixture bytes.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { replay } from './src/physics-reference/index.js';
const path=process.argv[2],c=JSON.parse(readFileSync(path,'utf8')),root=dirname(path);
const map=JSON.parse(readFileSync(join(root,c.map),'utf8')),profile=JSON.parse(readFileSync(join(root,c.profile),'utf8'));
const trace=await replay(map,profile,c.initial,c.input,c.ticks);
process.stdout.write(JSON.stringify(trace));
