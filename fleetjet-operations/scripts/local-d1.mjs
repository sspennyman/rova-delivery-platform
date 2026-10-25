import {DatabaseSync} from 'node:sqlite';
export function localD1(path=':memory:') {
 const db=new DatabaseSync(path);
 const prepare=sql=>({bind(...values){return statement(sql,values)},...statement(sql,[])});
 function statement(sql,values){return {bind(...next){return statement(sql,next)},async first(){return db.prepare(sql).get(...values)||null},async all(){return {results:db.prepare(sql).all(...values)}},async run(){const result=db.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)}}}}}
 return {prepare,async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results}catch(error){db.exec('ROLLBACK');throw error}},close(){db.close()}};
}
