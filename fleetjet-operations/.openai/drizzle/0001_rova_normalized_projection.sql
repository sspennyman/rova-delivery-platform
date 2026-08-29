-- Additive Rova SaaS projection. This migration does not alter or delete the
-- delivery_tracker_state_v1 canonical JSON record used by existing workspaces.
CREATE TABLE IF NOT EXISTS rova_businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL, pickup_address TEXT NOT NULL, time_zone TEXT NOT NULL, settings_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rova_users (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, email TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rova_drivers (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, driver_type TEXT NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT, vehicle TEXT, status TEXT NOT NULL, capacity INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rova_customers (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, display_name TEXT NOT NULL, address TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rova_routes (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, driver_id TEXT, origin TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rova_deliveries (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, customer_id TEXT, driver_id TEXT, route_id TEXT, status TEXT NOT NULL, priority TEXT NOT NULL, fulfillment_type TEXT NOT NULL, pickup TEXT, destination TEXT, window_start TEXT, window_end TEXT, distance_km REAL NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rova_delivery_stops (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, stop_order INTEGER NOT NULL, label TEXT, address TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rova_driver_locations (driver_id TEXT PRIMARY KEY, delivery_id TEXT, lat REAL, lng REAL, accuracy REAL, recorded_at TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rova_proof_of_delivery (delivery_id TEXT PRIMARY KEY, outcome TEXT, method TEXT, recipient TEXT, proof_json TEXT NOT NULL, recorded_at TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rova_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, monthly_price REAL NOT NULL, currency TEXT NOT NULL, limits_json TEXT NOT NULL, features_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rova_subscriptions (business_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rova_notifications (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, delivery_id TEXT, channel TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rova_network_jobs (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, delivery_id TEXT, quoted_price REAL, platform_fee REAL, external_driver_id TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rova_delivery_events (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, event_type TEXT NOT NULL, event_json TEXT NOT NULL, recorded_at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS idx_rova_deliveries_status ON rova_deliveries (business_id, status);
CREATE INDEX IF NOT EXISTS idx_rova_deliveries_driver ON rova_deliveries (driver_id, status);
CREATE INDEX IF NOT EXISTS idx_rova_stops_delivery ON rova_delivery_stops (delivery_id, stop_order);
CREATE INDEX IF NOT EXISTS idx_rova_events_delivery ON rova_delivery_events (delivery_id, recorded_at);
