<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
$rivo_connection = Rivo_Delivery_Connector::connection();
$rivo_status = get_option( Rivo_Delivery_Connector::STATUS, array() );
?>
<div class="wrap">
<h1><?php esc_html_e( 'Rivo Delivery', 'rivo-delivery' ); ?></h1>
<p><?php esc_html_e( 'Connect this store to your existing Rivo dispatch workspace. No order information is sent until you save a connection and explicitly enable sharing.', 'rivo-delivery' ); ?></p>
<?php if ( ! function_exists( 'wc_get_order' ) ) : ?><div class="notice notice-error inline"><p><?php esc_html_e( 'Activate WooCommerce before connecting orders.', 'rivo-delivery' ); ?></p></div><?php endif; ?>
<?php if ( ! empty( $rivo_status['message'] ) ) : ?><div class="notice notice-info inline"><p><?php echo esc_html( $rivo_status['message'] ); ?> <?php echo esc_html( $rivo_status['at'] ?? '' ); ?></p></div><?php endif; ?>
<h2><?php esc_html_e( '1. Create a Rivo connection', 'rivo-delivery' ); ?></h2>
<p><?php esc_html_e( 'In Rivo, open Connections, choose Universal webhook, and create a separate connection for this store. Copy the complete one-time webhook URL into the field below. Treat it like a password.', 'rivo-delivery' ); ?> <a href="https://app.floraljet.llc/operations" target="_blank" rel="noopener noreferrer"><?php esc_html_e( 'Open Rivo', 'rivo-delivery' ); ?></a></p>
<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
<input type="hidden" name="action" value="rivo_delivery_save"><?php wp_nonce_field( 'rivo_delivery_save' ); ?>
<table class="form-table" role="presentation"><tr><th scope="row"><label for="rivo_connection_url"><?php esc_html_e( 'Rivo webhook URL', 'rivo-delivery' ); ?></label></th><td><input class="regular-text" type="password" id="rivo_connection_url" name="rivo_connection_url" value="" autocomplete="new-password" placeholder="<?php echo esc_attr( ! empty( $rivo_connection['token'] ) ? __( 'Connection saved — leave blank to keep it', 'rivo-delivery' ) : 'https://app.floraljet.llc/api/integrations/webhook/…?token=…' ); ?>"><p class="description"><?php esc_html_e( 'Saved tokens are never displayed back on this page. Only URLs on app.floraljet.llc are accepted.', 'rivo-delivery' ); ?></p></td></tr>
<tr><th scope="row"><?php esc_html_e( 'Order sharing', 'rivo-delivery' ); ?></th><td><label><input type="checkbox" name="rivo_consent" value="1" <?php checked( ! empty( $rivo_connection['consent'] ) ); ?>><?php esc_html_e( 'Send delivery order details to my Rivo workspace.', 'rivo-delivery' ); ?></label><p class="description"><?php esc_html_e( 'This sends the order number, creation time, recipient name, delivery address, delivery phone when available, item summary and order/payment status. It never sends payment card data or marks an order paid or fulfilled.', 'rivo-delivery' ); ?></p></td></tr></table>
<?php submit_button( __( 'Save connection', 'rivo-delivery' ) ); ?></form>
<h2><?php esc_html_e( '2. Check the connection', 'rivo-delivery' ); ?></h2>
<?php foreach ( array( 'test' => __( 'Test connection', 'rivo-delivery' ), 'sync' => __( 'Sync the past 24 hours', 'rivo-delivery' ), 'disconnect' => __( 'Disconnect', 'rivo-delivery' ) ) as $rivo_action => $rivo_label ) : ?>
<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"><input type="hidden" name="action" value="<?php echo esc_attr( 'rivo_delivery_' . $rivo_action ); ?>"><?php wp_nonce_field( 'rivo_delivery_' . $rivo_action ); ?><?php submit_button( $rivo_label, 'secondary', 'submit', false ); ?></form><br>
<?php endforeach; ?>
<p><?php esc_html_e( 'New and changed orders from the past 24 hours are queued automatically. Delivery requires a shipping address. Imports use WooCommerce Scheduled Actions, or WordPress cron when unavailable, so processing depends on your site’s background jobs running.', 'rivo-delivery' ); ?></p>
<p><a href="https://floraljet.llc/privacy" target="_blank" rel="noopener noreferrer"><?php esc_html_e( 'Rivo privacy policy', 'rivo-delivery' ); ?></a> · <a href="https://floraljet.llc/terms" target="_blank" rel="noopener noreferrer"><?php esc_html_e( 'Rivo service terms', 'rivo-delivery' ); ?></a> · <a href="mailto:rivocanada@gmail.com"><?php esc_html_e( 'Support', 'rivo-delivery' ); ?></a></p>
</div>
