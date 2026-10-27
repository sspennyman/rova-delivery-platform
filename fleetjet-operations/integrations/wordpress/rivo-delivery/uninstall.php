<?php
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) { exit; }
delete_option( 'rivo_delivery_connection' );
delete_option( 'rivo_delivery_status' );
