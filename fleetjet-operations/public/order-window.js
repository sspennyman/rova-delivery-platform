// Wix creation time, never import time, defines the rolling daily queue.
export const ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;
export function withinOrderWindow(createdDate, now = Date.now()) {
  const created = Date.parse(createdDate || '');
  return Number.isFinite(created) && created >= now - ORDER_WINDOW_MS && created <= now;
}
export function outsideDailyOrderWindow(trip, now = Date.now()) {
  return trip.source?.system === 'wix' && !withinOrderWindow(trip.source.createdDate, now);
}
