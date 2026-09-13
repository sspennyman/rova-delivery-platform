if (window.location.hostname === "delivery-driver-tracker.spennyman.chatgpt.site") {
  const destination = new URL(window.location.href);
  destination.protocol = "https:";
  destination.hostname = "app.floraljet.llc";
  window.location.replace(destination.toString());
}
