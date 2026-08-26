# Rova Delivery Platform

Rova is a delivery operations platform for businesses using in-house drivers, third-party couriers, or both.

This repository contains two deployable projects:

- `rova-marketing/` — the public website, product walkthrough, live demo, pricing, and lead-capture pages.
- `fleetjet-operations/` — the dispatcher, driver, customer-tracking, routing, proof-of-delivery, mileage, and commerce-integration application.

## Local development

See `fleetjet-operations/README.md` for application setup, environment variables, local startup, and validation instructions. Each project has its own `package.json`, lockfile, build script, and Sites hosting configuration.

Environment values belong in local `.env` files or the deployment platform's secret store. Only the placeholder-only `.env.example` file is committed.
