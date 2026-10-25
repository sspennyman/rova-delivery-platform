export function createAssignmentAlerts({api,getAuth,getSnapshot,onSnapshot,notify,openRoute}) {
  const seen = new Set();
  let identity = "";
  let deviceEnabled = false;
  const supported = () => "Notification" in window && "PushManager" in window && "serviceWorker" in navigator;
  const unread = snapshot => (snapshot?.assignmentNotifications || []).filter(item=>!item.readAt && item.tripIds.some(id=>(snapshot.trips || []).some(trip=>trip.id === id && ["active","queued"].includes(trip.status))));
  function bannerHtml(snapshot) {
    const alerts=unread(snapshot);
    if (!alerts.length) return "";
    const count=new Set(alerts.flatMap(item=>item.tripIds)).size;
    return `<div class="driver-assignment-banner" role="status"><div><strong>${count} new order${count === 1 ? "" : "s"} assigned</strong><span>Your route has been updated.</span></div><button class="button" data-action="review-assignments" type="button">View orders</button></div>`;
  }
  function settingsHtml(snapshot) {
    const config=snapshot?.assignmentPush || {};
    const enabled=deviceEnabled && supported() && Notification.permission === "granted" && config.enabled;
    const help=!supported() ? "For phone push alerts, open Rivo in your browser. On iPhone, add it to the Home Screen and open it there. Native-app push is not connected yet." : !config.configured ? "Phone push is not configured yet. New assignments still appear in Rivo." : Notification.permission === "denied" ? "Notifications are blocked. Allow Rivo notifications in your browser or phone settings." : "Get an alert when dispatch assigns new orders—even when the installed web app is closed. Phone notification settings and network access apply.";
    return `<section class="panel"><div class="panel-body"><h3 class="panel-title">Order alerts</h3><p class="privacy-copy">${help}</p>${supported() && config.configured ? `<div class="driver-action-stack"><button class="button secondary" type="button" data-action="${enabled ? "test-assignment-alert" : "enable-assignment-alerts"}">${enabled ? "Send test notification" : "Enable order notifications"}</button>${enabled ? '<button class="button ghost" type="button" data-action="disable-assignment-alerts">Turn off phone alerts</button>' : ""}</div>` : ""}</div></section>`;
  }
  async function enable() {
    if (!supported()) throw new Error("Open Rivo from your Home Screen or a supported browser to enable push.");
    const config=getSnapshot()?.assignmentPush;
    if (!config?.configured || !config.publicKey) throw new Error("Push alerts are not configured yet.");
    const permission=await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Notifications were not enabled. You can still see new orders inside Rivo.");
    const registration=await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if (!subscription) {
      const text=config.publicKey.replace(/-/g,"+").replace(/_/g,"/");
      const bytes=Uint8Array.from(atob(text),character=>character.charCodeAt(0));
      subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
    }
    try {
      const result=await api("/api/assignment-notifications/subscribe",{method:"POST",body:{subscription:subscription.toJSON()}});
      deviceEnabled=true;
      onSnapshot(result.snapshot);
    } catch(error) {await subscription.unsubscribe().catch(()=>{});throw error;}
    await test();
  }
  async function test() {
    const result=await api("/api/assignment-notifications/test",{method:"POST",body:{}});
    notify(result.accepted ? "Test accepted by push service. Check your phone notifications." : "Push test was not accepted. Re-enable notifications and try again.");
  }
  async function disable() {
    if (!supported()) return;
    const registration=await navigator.serviceWorker.ready;
    const subscription=await registration.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint=subscription.endpoint;
    await subscription.unsubscribe();
    deviceEnabled=false;
    const result=await api("/api/assignment-notifications/unsubscribe",{method:"POST",body:{endpoint}});
    onSnapshot(result.snapshot);
  }
  async function review() {
    const ids=unread(getSnapshot()).map(item=>item.id);
    const result=await api("/api/assignment-notifications/read",{method:"POST",body:{ids}});
    onSnapshot(result.snapshot); openRoute();
  }
  function receive(snapshot) {
    const auth=getAuth();
    if (auth?.role !== "driver") {seen.clear();identity="";return;}
    if (identity !== auth.driverId) {seen.clear();identity=auth.driverId;}
    const fresh=unread(snapshot).filter(item=>!seen.has(item.id));
    fresh.forEach(item=>seen.add(item.id));
    if (fresh.length) notify(`${new Set(fresh.flatMap(item=>item.tripIds)).size} new orders assigned. Tap View orders to see your route.`);
  }
  return {bannerHtml,settingsHtml,enable,test,disable,review,receive};
}
