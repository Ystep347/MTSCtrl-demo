import {readFile,writeFile} from 'node:fs/promises';
import {makeMtsSimulationRaw} from '../lib/mts-simulation.mjs';
const input=new URL('../data/incidents.json',import.meta.url);
const output=new URL('../data/mts-simulation.json',import.meta.url);
const raw=JSON.parse(await readFile(input,'utf8'));
await writeFile(output,JSON.stringify(makeMtsSimulationRaw(raw),null,2)+'\n');
console.log(`Created ${raw.length} explicitly simulated MTS records in data/mts-simulation.json. Original export unchanged.`);
