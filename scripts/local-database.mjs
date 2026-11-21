// Local/test adapter. Hosted requests use the real D1 binding and migrations.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function createLocalDatabase(filename=':memory:'){
  if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true});
  const sqlite=new DatabaseSync(filename);sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
  const journal=JSON.parse(readFileSync(resolve(root,'drizzle/meta/_journal.json'),'utf8'));
  for(const item of journal.entries){
    if(sqlite.prepare('SELECT name FROM _local_migrations WHERE name=?').get(item.tag))continue;
    sqlite.exec('BEGIN IMMEDIATE');
    try{sqlite.exec(readFileSync(resolve(root,'drizzle',item.tag+'.sql'),'utf8'));sqlite.prepare('INSERT INTO _local_migrations VALUES (?)').run(item.tag);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}
  }
  function statement(sql,values=[]){return {sql,values,bind(...v){return statement(sql,v);},async first(column){const row=sqlite.prepare(sql).get(...values);return row?(column?row[column]:{...row}):null;},async all(){return {results:sqlite.prepare(sql).all(...values).map(x=>({...x})),success:true};},async run(){const result=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}};}
  return {prepare:statement,async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const result=[];for(const s of statements){const r=sqlite.prepare(s.sql).run(...s.values);result.push({success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}});}sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}},close(){sqlite.close();}};
}
