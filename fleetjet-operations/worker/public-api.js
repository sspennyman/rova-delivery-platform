// Server-to-server API. Explicit projections keep private mileage and credentials out.
export const API_SCOPES = ['orders:read', 'orders:write', 'drivers:read'];
export const publicApiKey = ({id, name, scopes, createdAt, expiresAt}) => ({id, name, scopes, createdAt, expiresAt});
export const apiOrder = t => ({id:t.id, externalId:t.source?.orderId || null, customerName:t.customerName,
  phone:t.customerPhone || '', pickup:t.pickup, destination:t.destination, status:t.status,
  deliveryOutcome:t.deliveryOutcomeStatus || null, driverId:t.driverId || null,
  startedAt:t.startedAt, completedAt:t.endedAt, distanceKm:t.distanceKm || 0});

export async function handlePublicApi(c) {
  const {request, url, db, session, readBody, json, hash, equal, token, scoped, id, save, createOrder, updateOrder} = c;
  const method = request.method;
  const fail = (error, status=400) => json({error},status);
  db.integrations.apiKeys ||= [];
  const keys = db.integrations.apiKeys;
  const keyPath = '/api/integrations/api-keys';
  if (url.pathname === keyPath || url.pathname.startsWith(keyPath+'/')) {
    if (session?.role !== 'dispatcher') return fail('Owner login required.',401);
    if (method === 'GET' && url.pathname === keyPath) return json({keys:keys.map(publicApiKey),scopes:API_SCOPES});
    if (method === 'POST' && url.pathname === keyPath) {
      const body = await readBody(request);
      if (!body || typeof body !== 'object') return fail('Provide a key name and scopes.');
      const name = String(body.name || '').trim();
      const scopes = [...new Set(Array.isArray(body.scopes) ? body.scopes : [])];
      if (!name || name.length>80 || !scopes.length || scopes.some(s=>!API_SCOPES.includes(s))) return fail('Choose a name and valid permissions.');
      if (keys.length>=25) return fail('Revoke an unused key before creating another.');
      const days = body.expiresInDays === undefined ? 90 : Number(body.expiresInDays);
      if (!Number.isInteger(days) || days<1 || days>365) return fail('Expiry must be 1–365 days.');
      const secret = scoped(db,'rivo_'+token(32));
      const key = {id:id('key'),name,scopes,tokenHash:await hash(secret),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+days*86400000).toISOString()};
      keys.push(key);
      await save();
      return json({key:publicApiKey(key),token:secret},201);
    }
    if (method === 'DELETE' && url.pathname.startsWith(keyPath+'/')) {
      const index = keys.findIndex(k=>k.id===url.pathname.slice(keyPath.length+1));
      if (index<0) return fail('Key not found.',404);
      keys.splice(index,1); await save(); return json({ok:true});
    }
    return fail('Not found.',404);
  }
  if (!url.pathname.startsWith('/api/v1/')) return null;
  const secret = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const digest = secret ? await hash(secret) : '';
  const key = keys.find(k=>equal(k.tokenHash,digest) && Date.parse(k.expiresAt)>Date.now());
  if (!key) return fail('A valid, unexpired API key is required.',401);
  if (url.pathname === '/api/v1/capabilities' && method === 'GET') return json({version:'1',scopes:key.scopes, endpoints:['GET /api/v1/orders','GET /api/v1/orders/:id','POST /api/v1/orders','PATCH /api/v1/orders/:id','GET /api/v1/drivers'], maxPageSize:100});
  const isDrivers = url.pathname === '/api/v1/drivers';
  const orderMatch = url.pathname.match(/^\/api\/v1\/orders(?:\/([^/]+))?$/);
  if (!isDrivers && !orderMatch) return fail('Not found.',404);
  const permission = isDrivers ? 'drivers:read' : method === 'GET' ? 'orders:read' : 'orders:write';
  if (!key.scopes.includes(permission)) return fail('Missing permission: '+permission,403);
  if (isDrivers && method !== 'GET' || orderMatch && !['GET','POST','PATCH'].includes(method)) return fail('Method not allowed.',405);
  const orders = db.trips.filter(t=>t.tripType === 'business');
  if (method === 'GET') {
    if (orderMatch?.[1]) {
      const order = orders.find(t=>t.id===orderMatch[1]);
      return order ? json({order:apiOrder(order)}) : fail('Order not found.',404);
    }
    const limit = Number(url.searchParams.get('limit') || 50);
    const offset = Number(url.searchParams.get('offset') || 0);
    if (!Number.isInteger(limit) || limit<1 || limit>100 || !Number.isSafeInteger(offset) || offset<0) return fail('Use limit 1–100 and a nonnegative offset.');
    const items = isDrivers ? db.drivers.filter(d=>!d.archivedAt).map(d=>({id:d.id,name:d.name,status:d.status,vehicle:d.vehicle})) : orders.filter(t=>!url.searchParams.has('status') || t.status===url.searchParams.get('status')).map(apiOrder);
    return json({data:items.slice(offset,offset+limit),nextOffset:offset+limit<items.length ? offset+limit : null,total:items.length});
  }
  const body = await readBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Provide an order object.');
  const allowed = new Set(['externalId','customerName','phone','pickup','destination']);
  if (Object.keys(body).some(k=>!allowed.has(k))) return fail('Supported fields: externalId, customerName, phone, pickup, destination.');
  for (const [field,value] of Object.entries(body)) if (typeof value!=='string' || value.length>(field==='externalId'?160:500) || field!=='phone' && !value.trim()) return fail('Invalid '+field+'.');
  if (method === 'POST' && !orderMatch[1]) {
    if (!body.externalId || !body.customerName || !body.pickup || !body.destination) return fail('externalId, customerName, pickup and destination are required.');
    const prior = orders.find(t=>t.source?.system==='api' && t.source.orderId===body.externalId.trim());
    if (prior) {
      const same = ['customerName','pickup','destination'].every(k=>prior[k]===body[k].trim()) && (prior.customerPhone || '')===(body.phone || '').trim();
      return same ? json({order:apiOrder(prior),replayed:true}) : fail('externalId already exists with different data; PATCH the queued order.',409);
    }
    const order = createOrder(body); db.trips.push(order); await save();
    return json({order:apiOrder(order),replayed:false},201);
  }
  if (method === 'PATCH' && orderMatch[1]) {
    if ('externalId' in body) return fail('externalId cannot be changed.');
    const order = orders.find(t=>t.id===orderMatch[1]);
    if (!order) return fail('Order not found.',404);
    if (order.status!=='queued') return fail('Only queued orders can be edited. Active deliveries keep their dispatched route.',409);
    updateOrder(order,body); await save(); return json({order:apiOrder(order)});
  }
  return fail('Method not allowed.',405);
}
