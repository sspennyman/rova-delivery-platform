import {withinOrderWindow, ORDER_WINDOW_MS} from '../public/order-window.js';
// Pending approved orders include offline payment. Import is not payment or
// fulfillment approval: preserve Wix's statuses for the dispatcher to review.
export async function searchWixOrders(config, fetcher = fetch) {
  if (!config.configured) throw new Error('Wix sync needs WIX_API_KEY and WIX_SITE_ID configured in production environment variables.');
  const now = Date.now();
  const createdDate = {$gte: new Date(now - ORDER_WINDOW_MS).toISOString()};
  const recent = {
    status: {$in: config.orderStatuses},
    paymentStatus: {$in: config.paymentStatuses},
    fulfillmentStatus: {$in: config.fulfillmentStatuses},
    createdDate
  };
  const outstanding = {
    status: {$in: config.orderStatuses},
    paymentStatus: {$in: ['PAID','NOT_PAID','PARTIALLY_PAID','PENDING','PENDING_MERCHANT','PARTIALLY_REFUNDED']},
    fulfillmentStatus: {$in: ['NOT_FULFILLED','PARTIALLY_FULFILLED']},
    createdDate
  };
  async function pages(filter) {
    const orders = [], cursors = new Set();
    let cursor;
    for (let page = 0; page < 50; page++) {
      const response = await fetcher('https://www.wixapis.com/ecom/v1/orders/search', {
        method: 'POST', headers: {Authorization: config.authorization, 'Content-Type':'application/json', 'wix-site-id':config.siteId},
        body: JSON.stringify({search:{...(cursor ? {} : {filter,sort:[{fieldName:'createdDate',order:'DESC'}]}),cursorPaging:{limit:100,...(cursor ? {cursor} : {})}}})
      });
      const payload = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(`Wix ${response.status}: ${payload.message || payload.error?.message || response.statusText || 'Order sync failed.'}`);
      if (!Array.isArray(payload.orders)) throw new Error('Wix returned an invalid orders response. No partial sync was saved.');
      orders.push(...payload.orders);
      if (!payload.metadata?.hasNext) return orders;
      const next = payload.metadata?.cursors?.next;
      if (!next || cursors.has(next)) throw new Error('Wix pagination did not advance. No partial sync was saved; please retry.');
      cursors.add(next); cursor=next;
    }
    throw new Error('This Wix backlog exceeds 5,000 orders. Contact support to finish the import; no partial sync was saved.');
  }
  const results = await Promise.allSettled([pages(recent),pages(outstanding)]);
  const failure=results.find(result=>result.status==='rejected');
  if(failure) throw failure.reason;
  const unique=new Map();
  for(const result of results) for(const order of result.value) if(order.id && withinOrderWindow(order.createdDate, now)) unique.set(order.id,order);
  return [...unique.values()];
}
