import {isFinishedIncident} from './incidents.mjs';
export function summarizeImport(before,after){
  const old=new Map(before.map(i=>[i.id,i])),next=new Map(after.map(i=>[i.id,i]));
  const comparable=i=>JSON.stringify({...i,history:undefined,isNew:undefined});
  const summary={added:0,changed:0,removed:0,completed:0};
  for(const i of after){const was=old.get(i.id);if(!was)summary.added++;else if(comparable(was)!==comparable(i))summary.changed++;if(was&&!isFinishedIncident(was)&&isFinishedIncident(i))summary.completed++;}
  for(const i of before)if(!next.has(i.id))summary.removed++;
  return summary;
}
