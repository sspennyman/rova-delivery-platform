# Rivo hosting and automatic order import

Assessment: 24 October 2026.

## Recommendation

Keep the current production app and data in place while completing the launch checks. Moving DNS to a new host does not solve owner login, Google Maps billing or store enrollment. The Worker backend currently uses Cloudflare D1 for workspace records and R2 for proof media; a Render web-service deployment needs storage adapters and a verified data migration first. The older Node server is not a feature-equivalent production replacement.

## What is implemented now

The dispatch app checks connected polling channels every 60 seconds while a dispatcher dashboard is visible, online and not editing. Manual and automatic imports share one browser request at a time. The server also skips automatic requests for channels attempted in the last minute, including source failures. Manual sync remains available. Wix imports retain their strict 24-hour source window, source-order deduplication and existing delivery assignment rules. A source failure cannot delay the dashboard's independent driver/GPS refresh.

This does not run while the dashboard is closed. Existing webhook connections remain push-based and are not polled.

## Always-on option: scheduler first

A small Render cron service could invoke a dedicated authenticated import endpoint every minute without moving the website or operational records. Before activation:

1. Confirm the correct Render workspace. Discovery currently returned My Workspace under aajjones99@gmail.com; the owner was unsure whether it is the Rivo account, so no resources were inspected or changed.
2. Implement a dedicated scoped scheduler credential and endpoint. It must grant only order import for the selected workspace, never reuse an owner password or login session.
3. Add a durable per-workspace import lease, bounded source requests and safe retry behavior. The existing optimistic database version check protects against lost updates, but does not prevent two schedulers from making duplicate upstream requests.
4. Verify source idempotence, active-route preservation, failure recovery, no customer emails, and simultaneous driver/dispatcher writes. Run one real sync before scheduling.
5. Approve the service cost before creation. Render documents a minimum monthly charge of $1 per cron service, plus runtime-based billing; this is not a total monthly cap. No Render service or billable resource was created.
6. Add last-success monitoring and an alert path, with no credentials or customer addresses in logs.

Render cron jobs have a single-run guarantee, use UTC schedules, and cannot access persistent disks. Their runtime can call the existing HTTPS API, so a full database migration is unnecessary for this approach.

## Full Render migration, later

- Implement a Node-compatible HTTP entry point with equivalent authorization and workspace isolation.
- Choose Postgres persistence and object storage for proof media; preserve passwords, sessions, route tokens, drivers, mileage, integration encryption and the full order history.
- Export and reconcile record counts, IDs, proofs and source-order mappings in a staging environment.
- Test driver tracking, delivery proof, public tracking links and all integrations against staging.
- Define cutover, write freeze, rollback and restore verification before changing DNS.

Do not run production on the old Node server or a transient filesystem.

## Launch blockers separate from hosting

- Owner sign-in: the supplied password was not accepted. No password was changed; the owner requested leaving login unchanged, so no recovery was performed.
- Google Maps: billing activation remains deferred by the owner. Open-map fallback is available, but Google routing must be activated and verified before being advertised as working.
- App stores: no Apple Developer Program or Google Play Console account is enrolled. Current iOS is a temporary personal development installation; Android AAB is unsigned. Enrollment, account verification, release signing, store declarations, review access and a measured background-GPS drive are required before submission.

Official references:
- https://render.com/docs/cronjobs
- https://render.com/docs/service-types
- https://developer.apple.com/programs/enroll/
- https://support.google.com/googleplay/android-developer/answer/6112435
