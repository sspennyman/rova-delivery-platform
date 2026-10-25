# Daily Wix order window

The previous pending-payment fix fetched outstanding approved orders without a creation-date cutoff. This incorrectly loaded old Wix backlog into the daily dispatch queue.

Wix searches now have a fixed rolling 24-hour creation-date window for both paid/recent and outstanding/offline-payment queries. Every returned order is checked again against the same window before import, including subsequent cursor pages. Old WIX_SYNC_LOOKBACK_DAYS settings cannot expand the window. Payment and fulfillment remain unchanged in Wix.

The dispatch queue, queue counts, selection, bulk assignment candidates, route previews and Pickups & other use Wix creation time. Older imports are retained in History with their original status; they are not labeled completed, deleted, or reimported. Manual deliveries, active routes and saved delivery proof remain intact. The open dashboard checks for aging records every minute without interrupting focused form fields.

Checks: 24-hour boundary/paging/payment regression, full Worker/D1 import and replay, dashboard/history behavior, pickup/POS classification, Sites bundle validation. Public assets and service-worker cache advanced to v99.
