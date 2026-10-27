import {withinOrderWindow, ORDER_WINDOW_MS} from '../public/order-window.js';
export const SHOPIFY_API_VERSION = '2026-10';
const ORDER_FIELDS = `id legacyResourceId name createdAt updatedAt cancelledAt displayFinancialStatus displayFulfillmentStatus phone note shippingAddress { firstName lastName address1 address2 city province zip country phone } lineItems(first:12) { nodes { name quantity } }`;
const ORDER_QUERY = `query RivoOrders($after:String,$query:String!) { orders(first:100,after:$after,sortKey:CREATED_AT,query:$query) { nodes { ${ORDER_FIELDS} } pageInfo { hasNextPage endCursor } } }`;
export function shopifyOrigin(value) {
  const url = new URL(/^https:\/\//.test(value) ? value : `https://${value}`);
  if (url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Enter the store’s .myshopify.com domain.');
  return url.origin;
}
export function normalizeGraphqlOrder(order) {
  const a=order.shippingAddress || {};
  return {id:String(order.legacyResourceId || order.id?.split('/').at(-1) || ''),number:order.name || '',customerName:[a.firstName,a.lastName].filter(Boolean).join(' ') || 'Shopify customer',destination:[a.address1,a.address2,a.city,a.province,a.zip,a.country].filter(Boolean).join(', '),phone:a.phone || order.phone || '',items:(order.lineItems?.nodes || []).map(i=>`${i.quantity}x ${i.name}`).join('; '),createdAt:order.createdAt || '',updatedAt:order.updatedAt || '',paymentStatus:order.displayFinancialStatus || '',fulfillmentStatus:order.displayFulfillmentStatus || '',orderStatus:order.cancelledAt ? 'cancelled' : 'open',notes:order.note || ''};
}
export async function shopifyGraphql(origin, accessToken, query, variables, fetcher=fetch) {
  const response=await fetcher(`${shopifyOrigin(origin)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':accessToken},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(15000)});
  const payload=await response.json().catch(()=>({}));
  if (!response.ok || payload.errors?.length) throw new Error(response.status===401 || response.status===403 ? 'Reconnect Shopify to restore order access.' : `Shopify order request failed (${response.status}). Check the connection’s permissions and retry.`);
  if (!payload.data) throw new Error('Shopify returned an invalid response. No partial import was saved.');
  return payload.data;
}
export async function searchShopifyOrders(connection,credentials,fetcher=fetch,now=Date.now()) {
  const query=`created_at:>=${new Date(now-ORDER_WINDOW_MS).toISOString()}`;
  const orders=new Map(),seen=new Set();let after=null;
  for(let page=0;page<50;page++) {
    const data=await shopifyGraphql(connection.storeUrl,credentials.accessToken,ORDER_QUERY,{after,query},fetcher);
    if(!Array.isArray(data.orders?.nodes) || !data.orders.pageInfo) throw new Error('Shopify returned invalid order pagination. No partial import was saved.');
    for(const order of data.orders.nodes) if(withinOrderWindow(order.createdAt,now)) {const n=normalizeGraphqlOrder(order);if(n.id)orders.set(n.id,n);}
    if(!data.orders.pageInfo.hasNextPage) return [...orders.values()];
    const next=data.orders.pageInfo.endCursor;
    if(!next || seen.has(next)) throw new Error('Shopify pagination did not advance. No partial import was saved.');
    seen.add(next);after=next;
  }
  throw new Error('More than 5,000 recent Shopify orders need reconciliation. No partial import was saved.');
}
export async function getShopifyOrder(connection,credentials,id,fetcher=fetch) {
  const gid=String(id).startsWith('gid://shopify/Order/') ? String(id) : `gid://shopify/Order/${id}`;
  if(!/^gid:\/\/shopify\/Order\/\d+$/.test(gid))throw new Error('Invalid Shopify order ID.');
  const data=await shopifyGraphql(connection.storeUrl,credentials.accessToken,`query RivoOrder($id:ID!) { order(id:$id) { ${ORDER_FIELDS} } }`,{id:gid},fetcher);
  return data.order ? normalizeGraphqlOrder(data.order) : null;
}
