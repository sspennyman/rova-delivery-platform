=== Rivo Delivery Connector ===
Tags: woocommerce, delivery, dispatch, routes, mileage
Requires at least: 6.5
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connect recent WooCommerce delivery orders to your Rivo dispatch workspace.

== Description ==
Rivo Delivery Connector sends recent delivery orders to the Rivo service so your team can review orders, arrange routes and assign drivers. The plugin requires WooCommerce and an existing Rivo workspace. Rivo service plans are separate from this connector; see https://floraljet.llc/pricing.

The connector is off by default. A store manager must provide a Rivo Universal webhook URL and explicitly enable order sharing. New and changed orders created in the past 24 hours are queued through WooCommerce Scheduled Actions, with WordPress cron as a fallback. A manual recent-order import and a connection test are available in WooCommerce > Rivo Delivery.

The plugin uses WooCommerce order APIs and declares compatibility with High-Performance Order Storage. It does not change checkout, payments, inventory or fulfillment status. Orders without a shipping street address are not sent.

= External service and privacy =
This plugin communicates with https://app.floraljet.llc only after a store manager enables the connection. It sends order IDs/numbers, creation times, recipient names, shipping addresses, delivery phone numbers when available, item summaries and order/payment statuses to the connected Rivo workspace. It does not send payment card data, customer passwords or browser analytics. The connection test sends an empty order batch with no customer data.

Connection credentials are stored in the WordPress options table with autoload disabled. They are not displayed in admin pages, URLs used for delivery, or logs. Protect your site's database and backups. Disabling sharing or deactivating the plugin stops delivery. Uninstalling removes local settings; it does not remove operational records already stored in Rivo.

Service: https://floraljet.llc
Terms: https://floraljet.llc/terms
Privacy: https://floraljet.llc/privacy
Support: rivocanada@gmail.com

== Installation ==
1. Install and activate WooCommerce, then upload the Rivo Delivery Connector ZIP under Plugins > Add New.
2. In Rivo Connections, create a Universal webhook connection dedicated to this store and copy the generated URL.
3. Open WooCommerce > Rivo Delivery. Paste the complete URL and explicitly enable order sharing.
4. Save, test the connection, then choose Sync the past 24 hours if required.
5. Review the pickup address and imported work in Rivo before dispatching.

== Frequently Asked Questions ==
= Does activating the plugin send orders? =
No. A manager must save a connection and enable sharing first.

= Does this mark orders delivered or paid? =
No. It only sends source order details and statuses to Rivo.

= Why might orders take time to appear? =
Your site's Scheduled Actions or WordPress cron must run. Transient connection errors are retried up to five times. A failed connection is shown in the plugin's settings.

== Changelog ==
= 0.1.0 =
Initial connector: explicit consent, recent orders, queued updates, bounded retries, connection testing and HPOS-compatible order access.
