# Rova Operations

Rova is a delivery command center for dispatchers, drivers, and customers. It imports orders from connected storefronts, builds multi-stop routes, tracks active deliveries, and records paid business travel including home-to-work and return-home legs.

## Run locally

```sh
./start-tracker.sh
```

Open:

- Public/login gateway: `http://127.0.0.1:5173/`
- Operations app: `http://127.0.0.1:5173/operations`
- Owner setup: `http://127.0.0.1:5173/setup`

The local server delegates requests to the same worker used in production. Local records are stored in `work/data/db.json`; hosted records use the attached database and survive deployments.

Fresh installations have no demo credentials. Set a unique `OWNER_SETUP_CODE`, visit `/setup`, and create the first dispatcher account. Set `COMPANY_NAME` to customize the organization name shown in the app.

## Driver invitations and sign-in

Dispatchers invite a driver from **Drivers** by entering the driver's email address and profile details. Rova creates a single-use invitation that opens the account-creation screen at `/operations?invite=...`. The driver sets a password once, then signs in with that email address afterward.

Invitation links expire. A dispatcher can issue a fresh password-reset invitation from the driver's profile when needed. The roster shows whether an invitation is pending, accepted, expired, or needs attention.

To send invitation emails automatically, configure both:

```env
RESEND_API_KEY=re_...
INVITE_FROM_EMAIL=Rova <drivers@your-verified-domain.com>
```

The sender domain must be verified with Resend. If email is not configured or delivery fails, the driver is still created and Rova presents persistent **Share**, **Copy link**, and **Open test** controls so the dispatcher can send the invitation manually without losing it.

Passwords are stored as salted PBKDF2-SHA256 hashes. Login endpoints are rate-limited and authentication responses are marked `no-store`.

## Dispatch and routes

- Select one or several queued orders and assign them to the same driver.
- Reorder active stops by dragging them; the map updates the route preview.
- Edit the driver, rate, route details, notes, and status of active deliveries.
- Mark completed stops and share separate customer tracking links.
- Google Maps provides the driving route, ETA, and optimized stop order when configured.
- A keyless live map remains available for driver GPS tracking if Google Maps is unavailable.

Every recorded trip is business mileage. Deliveries, pickups, paid home-origin travel, and return-home kilometres can be included in weekly approval and CSV reporting.

## Driver mobile app

Rova is an installable progressive web app. A driver opens the invitation on a phone, creates the account, signs in, and can add the app to the home screen.

The driver view includes assigned routes, next-stop navigation, device GPS publishing, customer tracking links, completion outcomes and notes, and weekly business-kilometre submission. Drivers only receive trips assigned to their own account. Location access requires HTTPS outside local development.

## Commerce connections

The **Channels** screen connects:

- Shopify using the `.myshopify.com` store address and an Admin API token
- WooCommerce using the store URL and read-only REST API credentials
- Wix using the site ID and API key
- Any webhook-capable storefront or automation, including Squarespace, Square, BigCommerce, Ecwid, Zapier, Make, and custom sites

Credentials are encrypted before storage. Configure `INTEGRATION_ENCRYPTION_KEY` with a long random value in production; `OWNER_SETUP_CODE` is the fallback encryption secret.

Connected channels normalize incoming orders into one dispatch queue and de-duplicate them by connection and source order ID. Wix sync defaults to paid orders from the prior day and polls every five minutes; these settings can be changed through the related environment variables in `.env.example`.

## Google Maps

Set `GOOGLE_MAPS_BROWSER_API_KEY` to a browser-referrer-restricted key for the embedded map, and `GOOGLE_MAPS_SERVER_API_KEY` to a Routes API-restricted server key for stop optimization. `GOOGLE_MAPS_MAP_ID` is optional. Existing workspaces can continue using `GOOGLE_MAPS_API_KEY` as a legacy fallback while the two keys are separated.

Without a usable Google Maps key, Rova automatically shows its OpenFreeMap-based GPS view and keeps external Google Maps navigation links available.

## Verify the production bundle

```sh
pnpm run build
pnpm run validate
```

The validator exercises the driver invitation and email-login lifecycle, password migration, duplicate-account protection, rate limiting, route-preview integration, and the built Sites bundle.
