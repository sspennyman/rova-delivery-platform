// Wix's structured pickup method wins over shipping labels and billing addresses.
export function wixFulfillment(order = {}) {
  const shipping = order.shippingInfo || {};
  const logistics = shipping.logistics || {};
  const pickup = logistics.pickupDetails || {};
  const pickupMethod = String(pickup.pickupMethod || "").toUpperCase();
  const address = logistics.shippingDestination?.address || order.recipientInfo?.address
    || order.fulfillmentInfo?.shippingDestination?.address || {};
  const hasDestination = Boolean(address.formattedAddress || address.addressLine || address.addressLine1
    || address.streetAddress?.name);
  // These are recognizable carrier services, not evidence of an in-house route.
  // Unknown/custom shipping labels retain their existing behavior; dispatch can
  // explicitly choose delivery for any held order without altering Wix itself.
  const carrierService = /\b(xpresspost|expedited parcel|canada post|postes canada|fedex|ups|usps|dhl|purolator)\b/i.test(String(shipping.title || ""));
  let fulfillmentMethod = "delivery";
  if (pickupMethod === "STORE_PICKUP") fulfillmentMethod = "customer-pickup";
  else if (!hasDestination) fulfillmentMethod = "needs-details";
  else if (carrierService) fulfillmentMethod = "carrier-shipping";
  else if (String(order.fulfillmentStatus || "").toUpperCase() === "FULFILLED") fulfillmentMethod = "fulfillment-review";
  return { fulfillmentMethod, shippingTitle: String(shipping.title || ""),
    pickupMethod, pickupAddress: pickup.address || (pickupMethod === "STORE_PICKUP" ? address : {}) };
}

export function fulfillmentMethodForTrip(trip) {
  // An upstream FULFILLED flag is a review gate for new imports, not a reason
  // to reclassify a delivery whose route, mileage or proof already exists.
  if (trip?.source?.system === "wix" && !trip.source.fulfillmentOverride
    && ["fulfillment-review", "carrier-shipping"].includes(trip.source.fulfillmentMethod)
    && (trip.status === "active" || trip.startedAt || trip.proof || trip.submittedAt || trip.distanceKm > 0)) return "delivery";
  if (trip?.source?.system === "wix" && !trip.source.fulfillmentOverride
    && trip.status === "queued" && !trip.startedAt && !trip.proof && !trip.submittedAt && !(trip.distanceKm > 0)
    && (!trip.source.fulfillmentMethod || trip.source.fulfillmentMethod === "delivery")) {
    // Protect existing imported queues even if the Wix lookback no longer
    // fetches the order. Historical and active delivery work is unchanged.
    return wixFulfillment({ fulfillmentStatus: trip.source.fulfillmentStatus,
      shippingInfo: { title: trip.source.shippingTitle, logistics: {
        shippingDestination: { address: { addressLine: trip.destination === "Delivery address missing" ? "" : trip.destination } }
      } } }).fulfillmentMethod;
  }
  return trip?.source?.fulfillmentOverride || trip?.source?.fulfillmentMethod
    || (trip?.status === "pickup" ? "customer-pickup" : ["store-sale", "order-review"].includes(trip?.status) ? "needs-details" : "delivery");
}

export function isNonDeliveryOrder(trip) {
  return ["customer-pickup", "in-store", "needs-details", "carrier-shipping", "fulfillment-review"].includes(fulfillmentMethodForTrip(trip))
    || ["pickup", "store-sale", "order-review"].includes(trip?.status);
}
