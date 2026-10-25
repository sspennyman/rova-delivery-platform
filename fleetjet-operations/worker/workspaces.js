const keyPattern = /^ws_[a-f0-9]{32}$/;
export const workspaceKey = value => keyPattern.test(String(value || '')) ? String(value) : 'primary';
export function scopedToken(db, value) {
  const key = workspaceKey(db.company?.workspaceKey);
  return key === 'primary' || String(value).startsWith(key + '.') ? value : `${key}.${value}`;
}
export async function ensureWorkspaceDirectory(env) {
  if (!env.DB) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS rivo_workspace_accounts (email TEXT PRIMARY KEY, state_key TEXT NOT NULL, created_at TEXT NOT NULL)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS rivo_driver_directory (email TEXT NOT NULL,state_key TEXT NOT NULL,PRIMARY KEY(email,state_key))').run();
}
export async function scopeEnvironment(request, env, url) {
  const cookie = String(request.headers.get('cookie') || '').match(/(?:^|;\s*)rivo_session=([^;]+)/)?.[1];
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || request.headers.get('x-session-token');
  const publicToken=url.pathname.startsWith('/api/share/') ? url.pathname.split('/').at(-1) : url.pathname === '/api/auth/invite' || url.pathname.startsWith('/api/proof-media/') ? url.searchParams.get('token') : null;
  const token = publicToken || bearer || (cookie ? decodeURIComponent(cookie) : '') || url.searchParams.get('token');
  let key = workspaceKey(String(token || '').split('.')[0]);
  if (url.pathname === '/api/auth/invite/accept' && request.method === 'POST') {
    const body = await request.clone().json().catch(() => ({}));
    key = workspaceKey(String(body.token || '').split('.')[0]);
  }
  if (key === 'primary') key = workspaceKey(url.searchParams.get('workspace'));
  // Login resolves the submitted identity, not a stale browser cookie from another workspace.
  if (url.pathname === '/api/auth/login' && request.method === 'POST') key = workspaceKey(url.searchParams.get('workspace'));
  if (key === 'primary' && url.pathname === '/api/auth/login' && request.method === 'POST') {
    const body = await request.clone().json().catch(() => ({}));
    await ensureWorkspaceDirectory(env);
    const email=String(body.identifier || '').trim().toLowerCase();
    const row = env.DB ? await env.DB.prepare('SELECT state_key FROM rivo_workspace_accounts WHERE email = ?').bind(email).first() : {state_key:globalThis.__rivoAccounts?.get(email)};
    if (row) key = workspaceKey(row.state_key);
    if (key === 'primary' && env.DB) {
      const matches=await env.DB.prepare('SELECT state_key FROM rivo_driver_directory WHERE email = ? LIMIT 2').bind(email).all();
      if(matches.results?.length === 1) key=workspaceKey(matches.results[0].state_key);
    }
  }
  if (key === 'primary') return env;
  return {...env, RIVO_STATE_KEY:key, OWNER_SETUP_CODE:'', DISPATCHER_USERNAME:'', DISPATCHER_PASSWORD:'', WIX_API_KEY:'', WIX_SITE_ID:''};
}
