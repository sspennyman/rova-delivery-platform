import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const runtime=process.env.RIVO_PHP_RUNTIME || '/Users/spencer/.cache/rivo-wordpress-runtime/node_modules';
const {PHP,loadPHPRuntime}=await import(pathToFileURL(runtime+'/@php-wasm/universal/index.js'));
const {getPHPLoaderModule}=await import(pathToFileURL(runtime+'/@php-wasm/node-8-3/index.js'));
const php=new PHP(await loadPHPRuntime(await getPHPLoaderModule()));
for(const name of ['rivo-delivery.php','settings.php','uninstall.php']) {
 const source=await readFile(new URL('../integrations/wordpress/rivo-delivery/'+name,import.meta.url),'utf8');php.writeFile('/'+name,source);
 const output=await php.runStream({code:`<?php $code=file_get_contents('/${name}');token_get_all($code, TOKEN_PARSE);echo 'syntax-ok';`});assert.equal(await output.stdoutText,'syntax-ok',name);assert.equal(await output.stderrText,'');
}
const fixture=`<?php
define('ABSPATH','/');define('DAY_IN_SECONDS',86400);$options=[];$sent=[];$queue=[];
function add_action(...$v){} function register_deactivation_hook(...$v){} function __( $s,$domain='' ){return $s;} function get_option($key,$default=false){global $options;return $options[$key]??$default;} function update_option($key,$value,$autoload=false){global $options;$options[$key]=$value;} function wp_parse_url($url){return parse_url($url);} function absint($v){return abs((int)$v);} function is_wp_error($v){return $v instanceof WP_Error;} function wp_json_encode($v){return json_encode($v);} function wp_safe_remote_post($url,$args){global $sent;$sent[]=[$url,$args];return ['response'=>['code'=>202]];} function wp_remote_retrieve_response_code($v){return $v['response']['code'];} function as_has_scheduled_action(...$v){return false;} function as_schedule_single_action($time,$hook,$args,$group,$unique){global $queue;$queue[]=$args;return 1;} class WP_Error {public function __construct($code,$message){}}
class FixtureOrder {public $age;public function __construct($age){$this->age=$age;}public function get_date_created(){return new DateTime('@'.(time()-$this->age));}public function get_id(){return 123;}public function get_order_number(){return '1001';}public function get_status(){return 'pending';}public function is_paid(){return false;}public function get_shipping_first_name(){return 'Fixture';}public function get_shipping_last_name(){return 'Customer';}public function get_shipping_phone(){return '';}public function get_shipping_address_1(){return '123 Example Street';}public function get_shipping_address_2(){return '';}public function get_shipping_city(){return 'Ottawa';}public function get_shipping_state(){return 'ON';}public function get_shipping_postcode(){return 'K1A 0A1';}public function get_shipping_country(){return 'CA';}public function get_items(){return [];}}
$order=new FixtureOrder(3600);function wc_get_order($id){global $order;return $order;}
require '/rivo-delivery.php';
function check($value,$message){if(!$value)throw new Exception($message);}
Rivo_Delivery_Connector::send_order(123);check(count($sent)===0,'disabled plugin must not contact Rivo');
$valid='https://app.floraljet.llc/api/integrations/webhook/fixture?token='.str_repeat('x',32);$parsed=Rivo_Delivery_Connector::parse_connection($valid);check(!is_wp_error($parsed),'valid URL');$parsed['consent']=true;$options[Rivo_Delivery_Connector::OPTION]=$parsed;
foreach(['http://app.floraljet.llc/api/integrations/webhook/fixture?token='.str_repeat('x',32),'https://app.floraljet.llc.evil.test/api/integrations/webhook/fixture?token='.str_repeat('x',32),'https://user:pass@app.floraljet.llc/api/integrations/webhook/fixture?token='.str_repeat('x',32),'https://app.floraljet.llc/api/other?token='.str_repeat('x',32)] as $bad)check(is_wp_error(Rivo_Delivery_Connector::parse_connection($bad)),'unsafe URL accepted');
Rivo_Delivery_Connector::send_order(123);check(count($sent)===1,'recent delivery sent');check(strpos($sent[0][0],'token=')===false,'secret must stay out of request URL');check($sent[0][1]['redirection']===0,'no credential forwarding through redirects');check($sent[0][1]['sslverify']===true,'TLS verification');$payload=json_decode($sent[0][1]['body'],true);check($payload['orders'][0]['paymentStatus']==='pending','pending payment preserved');
$order=new FixtureOrder(90000);Rivo_Delivery_Connector::send_order(123);Rivo_Delivery_Connector::enqueue(123);check(count($sent)===1 && count($queue)===0,'old orders must not be sent or queued');
echo 'plugin-checks-ok';`;
const output=await php.runStream({code:fixture});const stdout=await output.stdoutText,stderr=await output.stderrText;assert.equal(stderr,'');assert.equal(stdout,'plugin-checks-ok');php.exit();
console.log('WordPress PHP 8.3 passed: all files parse, opt-in guard, endpoint/credential validation, no redirects, TLS, secret-free delivery URLs, pending payment preservation and strict 24-hour exclusion.');
