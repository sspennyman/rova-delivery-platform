import {buildPushPayload} from "@block65/webcrypto-web-push";

export function pushConfigured(env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

export function validatedPushSubscription(input) {
  const endpoint = new URL(String(input?.endpoint || ""));
  const host = endpoint.hostname.toLowerCase();
  const allowed = ["fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com", "push.services.mozilla.com"].includes(host) || host.endsWith(".notify.windows.com");
  if (!allowed || endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port || endpoint.hash || endpoint.href.length > 2048) throw new Error("Unsupported push service.");
  const p256dh = String(input?.keys?.p256dh || "");
  const auth = String(input?.keys?.auth || "");
  if (!/^[A-Za-z0-9_-]{87}=?$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}={0,2}$/.test(auth)) throw new Error("Invalid push subscription keys.");
  return {endpoint:endpoint.href,expirationTime:null,keys:{p256dh,auth}};
}

export function assignmentBaseline(trips) {
  return new Map(trips.map(trip=>[trip.id,{driverId:trip.driverId,status:trip.status}]));
}

export function queueAssignmentNotifications(db, before, now, makeId) {
  if (!before) return [];
  const byDriver = new Map();
  for (const trip of db.trips) {
    if (!trip.driverId || !["queued","active"].includes(trip.status)) continue;
    const old = before.get(trip.id);
    const newlyAssigned = !old || old.driverId !== trip.driverId || (!["queued","active"].includes(old.status) && trip.status === "active");
    if (!newlyAssigned) continue;
    if (!byDriver.has(trip.driverId)) byDriver.set(trip.driverId,[]);
    byDriver.get(trip.driverId).push(trip.id);
  }
  const alerts = Array.from(byDriver,([driverId,tripIds])=>({id:makeId("assignment"),driverId,tripIds,createdAt:now,readAt:null,pushStatus:"pending"}));
  db.assignmentNotifications = [...(db.assignmentNotifications || []),...alerts].slice(-1000);
  return alerts;
}

export function publicAssignmentNotifications(db, driverId) {
  return (db.assignmentNotifications || []).filter(item=>!driverId || item.driverId === driverId).slice(-50).map(item=>({id:item.id,driverId:item.driverId,tripIds:item.tripIds,createdAt:item.createdAt,readAt:item.readAt,pushStatus:item.pushStatus}));
}

export async function deliverAssignmentPush(db, env, alerts, fetcher = fetch) {
  for (const alert of alerts) {
    if (!pushConfigured(env)) {alert.pushStatus="not-configured";continue;}
    const subscriptions = (db.pushSubscriptions || []).filter(item=>item.driverId === alert.driverId && !item.disabledAt && Date.parse(item.sessionExpiresAt)>Date.now() && db.sessions.some(session=>session.token === item.sessionToken && session.role === "driver" && session.driverId === alert.driverId));
    if (!subscriptions.length) {alert.pushStatus="not-enabled";continue;}
    let accepted = 0;
    for (const device of subscriptions) {
      try {
        const subscription = validatedPushSubscription(device.subscription);
        const payload = await buildPushPayload({data:{title:alert.test ? "Rivo alerts enabled" : "New Rivo orders",body:alert.test ? "This is your test notification. New assignments will alert you here." : `${alert.tripIds.length} new order${alert.tripIds.length === 1 ? "" : "s"} assigned. Open Rivo to see your route.`,url:"/#today",tag:alert.id},options:{ttl:3600,urgency:"high"}},subscription,{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
        const response = await fetcher(subscription.endpoint,{...payload,redirect:"error",signal:AbortSignal.timeout(8000)});
        if (response.ok) accepted++;
        else if ([404,410].includes(response.status)) device.disabledAt=new Date().toISOString();
      } catch { /* Keep assignment successful even when a push service fails. */ }
    }
    alert.pushStatus = accepted ? "accepted" : "failed";
  }
}
