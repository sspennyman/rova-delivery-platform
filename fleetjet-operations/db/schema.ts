// Canonical normalized D1 schema contract for Rova.
// The existing delivery_tracker_state_v1 record remains the write-safe source
// while these tables are refreshed as an additive analytics and SaaS projection.
export const rovaSchema = {
  businesses: "rova_businesses",
  users: "rova_users",
  drivers: "rova_drivers",
  customers: "rova_customers",
  routes: "rova_routes",
  deliveries: "rova_deliveries",
  deliveryStops: "rova_delivery_stops",
  driverLocations: "rova_driver_locations",
  proofOfDelivery: "rova_proof_of_delivery",
  plans: "rova_plans",
  subscriptions: "rova_subscriptions",
  notifications: "rova_notifications",
  networkJobs: "rova_network_jobs",
  deliveryEvents: "rova_delivery_events"
} as const;

export type RovaTable = (typeof rovaSchema)[keyof typeof rovaSchema];
