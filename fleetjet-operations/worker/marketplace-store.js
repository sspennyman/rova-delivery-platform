// Platform-wide directory: only verified platform identity may select a workspace.
export async function marketplaceStore(env) {
  if(!env.DB)throw Error('Marketplace installation requires persistent storage.');
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS rivo_market_installs (provider TEXT NOT NULL,external_id TEXT NOT NULL,workspace_key TEXT NOT NULL,connection_id TEXT NOT NULL,revoked_at TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(provider,external_id))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS rivo_market_states (state_hash TEXT PRIMARY KEY,external_id TEXT NOT NULL,workspace_key TEXT NOT NULL,expires_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS rivo_market_events (event_key TEXT PRIMARY KEY,provider TEXT NOT NULL,external_id TEXT NOT NULL,event_type TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT \'pending\',created_at TEXT NOT NULL,completed_at TEXT,last_error TEXT)')
  ]);
  return {
    async installation(provider,id) {return env.DB.prepare('SELECT * FROM rivo_market_installs WHERE provider = ? AND external_id = ?').bind(provider,id).first();},
    async link(provider,id,key,connectionId) {
      const r=await env.DB.prepare('INSERT INTO rivo_market_installs(provider,external_id,workspace_key,connection_id,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(provider,external_id) DO UPDATE SET connection_id=excluded.connection_id,revoked_at=NULL,updated_at=excluded.updated_at WHERE rivo_market_installs.workspace_key=excluded.workspace_key').bind(provider,id,key,connectionId,new Date().toISOString()).run();
      if(Number(r.meta?.changes)!==1)throw Error('This store is already connected to another Rivo workspace. Contact support to transfer it.');
    },
    async revoke(provider,id) {await env.DB.prepare('UPDATE rivo_market_installs SET revoked_at = ? WHERE provider = ? AND external_id = ?').bind(new Date().toISOString(),provider,id).run();},
    async state(hash,externalId,key) {await env.DB.prepare('DELETE FROM rivo_market_states WHERE expires_at < ?').bind(Date.now()).run();await env.DB.prepare('INSERT INTO rivo_market_states(state_hash,external_id,workspace_key,expires_at) VALUES (?,?,?,?)').bind(hash,externalId,key,Date.now()+600000).run();},
    async consume(hash) {
      const row=await env.DB.prepare('SELECT * FROM rivo_market_states WHERE state_hash = ? AND expires_at > ?').bind(hash,Date.now()).first();
      if(!row)return null;
      const r=await env.DB.prepare('DELETE FROM rivo_market_states WHERE state_hash = ?').bind(hash).run();return Number(r.meta?.changes)===1?row:null;
    },
    async enqueue(eventKey,provider,id,eventType,payload) {
      await env.DB.prepare('INSERT INTO rivo_market_events(event_key,provider,external_id,event_type,payload_json,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING').bind(eventKey,provider,id,eventType,JSON.stringify(payload),new Date().toISOString()).run();
      return env.DB.prepare('SELECT * FROM rivo_market_events WHERE event_key = ?').bind(eventKey).first();
    },
    async privacy(key) {
      const result=await env.DB.prepare("SELECT e.* FROM rivo_market_events e JOIN rivo_market_installs i ON e.provider=i.provider AND e.external_id=i.external_id WHERE i.workspace_key=? AND e.event_type IN ('customers/data_request','customers/redact','shop/redact') ORDER BY e.created_at DESC LIMIT 200").bind(key).all();
      return result.results || [];
    },
    async resolvePrivacy(id,note) {
      await env.DB.prepare("UPDATE rivo_market_events SET status='complete',payload_json='{}',completed_at=?,last_error=? WHERE event_key=?").bind(new Date().toISOString(),note,id).run();
    },
    async finish(id) {await env.DB.prepare('UPDATE rivo_market_events SET status = \'complete\',payload_json = \'{}\',completed_at = ?,last_error = NULL WHERE event_key = ?').bind(new Date().toISOString(),id).run();},
    async fail(id) {await env.DB.prepare('UPDATE rivo_market_events SET last_error = ? WHERE event_key = ?').bind('Processing failed; retry required.',id).run();}
  };
}
