package ca.rivo.mileage;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import android.webkit.CookieManager;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.*;

public final class MainActivity extends Activity {
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView web;
    private TextView status;
    private ImageView logo;
    private ImageButton settingsButton;
    private boolean lightAppearance;
    private String activeAppearance = "";
    private final Runnable appearancePoll = new Runnable() { public void run() { applyAppearance(); if(foreground)main.postDelayed(this,1000); } };
    private android.animation.ObjectAnimator logoAnimation;
    private volatile String trackingDetail = "Sign in as a driver to enable automatic mileage";
    private volatile String driver = "", device = "", sessionHash = "";
    private volatile long expiresAt;
    private volatile boolean checking = false, foreground = false;
    private boolean awaitingPermission = false;
    private ValueCallback<Uri[]> fileCallback;
    private String downloadUrl = "";
    private final Runnable poll = new Runnable() { public void run() { checkAccount(false); if (foreground) main.postDelayed(this, 20000); } };
    private android.content.SharedPreferences prefs() { return TrackingService.prefs(this); }
    private boolean trusted(Uri uri) { return "https".equals(uri.getScheme()) && "app.floraljet.llc".equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443); }
    private void message(String text) {
        trackingDetail = text == null ? "Check tracking settings" : text;
        main.post(() -> {
            String compact = driver.isEmpty() ? "Sign in to track" : prefs().getBoolean("paused", true) ? "Tracking off" : trackingDetail.startsWith("Auto-track enabled") ? "Tracking on" : "Check tracking";
            status.setText(compact);
            status.setContentDescription("Tracking status: " + trackingDetail + ". Opens Settings.");
        });
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void pauseTracking() {
        prefs().edit().putBoolean("paused", true).apply();
        stopService(new Intent(this, TrackingService.class)); message("Tracking paused");
        network.execute(() -> { try { Api.call("/api/mileage/consent", new JSONObject().put("enabled", false).put("deviceId", device)); } catch (Exception e) { message("Paused on this phone; connect to update the server"); } });
    }
    private String appearancePreference() {
        String cookies = CookieManager.getInstance().getCookie(Api.ORIGIN);
        if(cookies != null) for(String item:cookies.split(";")) {
            String value=item.trim();
            if(value.startsWith("rivo_theme=")) {String mode=value.substring(11);if(mode.equals("light")||mode.equals("dark")||mode.equals("auto"))return mode;}
        }
        return "auto";
    }
    private void applyAppearance() {
        String mode=appearancePreference(); int hour=java.time.LocalTime.now().getHour();
        boolean light=mode.equals("light")||(mode.equals("auto")&&hour>=7&&hour<19);
        if(activeAppearance.equals(mode)&&light==lightAppearance)return;
        activeAppearance=mode;lightAppearance=light;
        setTheme(light ? R.style.RivoLightTheme : R.style.RivoTheme);
        int background=light?Color.rgb(244,247,251):Color.rgb(5,5,6), ink=light?Color.rgb(23,32,51):Color.rgb(244,244,245);
        web.setBackgroundColor(background);((android.view.View)web.getParent()).setBackgroundColor(background);
        status.setTextColor(light?Color.rgb(89,101,121):Color.rgb(161,161,170));logo.setColorFilter(light?Color.rgb(36,91,133):Color.rgb(145,191,232));settingsButton.setColorFilter(ink);
        getWindow().setStatusBarColor(background);getWindow().setNavigationBarColor(background);
        getWindow().getDecorView().setSystemUiVisibility(light ? android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
    }
    private void showSettings() {
        LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL); panel.setPadding(dp(24), dp(12), dp(24), dp(8));
        TextView detail = new TextView(this); detail.setText(trackingDetail); detail.setTextSize(15); detail.setTextColor(lightAppearance?Color.rgb(23,32,51):Color.rgb(244,244,245)); panel.addView(detail);
        Spinner theme = new Spinner(this);theme.setContentDescription("Display theme");
        theme.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"Automatic · time of day","Light","Dark"}));
        String[] modes={"auto","light","dark"};String initial=appearancePreference();theme.setSelection(initial.equals("light")?1:initial.equals("dark")?2:0);panel.addView(theme);
        theme.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            public void onNothingSelected(AdapterView<?> parent) {}
            public void onItemSelected(AdapterView<?> parent,android.view.View view,int index,long id) {
                String mode=modes[index];if(mode.equals(appearancePreference()))return;
                CookieManager.getInstance().setCookie(Api.ORIGIN,"rivo_theme="+mode+"; Domain=floraljet.llc; Path=/; Max-Age=31536000; Secure; SameSite=Lax",ok->{CookieManager.getInstance().flush();applyAppearance();});
            }
        });
        TextView schedule = new TextView(this);schedule.setText("Automatic: light 7 am–7 pm, dark overnight. Uses your device’s local time.");panel.addView(schedule);
        Switch autoTrack = new Switch(this); autoTrack.setText("Auto-track"); autoTrack.setMinHeight(dp(60)); autoTrack.setChecked(!prefs().getBoolean("paused",true) && !driver.isEmpty()); panel.addView(autoTrack);
        TextView help = new TextView(this); help.setText("Enable once while parked. Rivo records detected drives with the screen locked. Personal trips stay private until submitted as business. The ongoing location notification shows recording status and lets you pause anytime."); help.setTextColor(lightAppearance?Color.rgb(89,101,121):Color.rgb(161,161,170)); help.setTextSize(14); panel.addView(help);
        TextView permission = new TextView(this); permission.setPadding(0,dp(16),0,dp(16)); permission.setText("Precise location: " + (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ? "Allowed" : "Not allowed")); panel.addView(permission);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Settings").setView(panel).setPositiveButton("Done",null).setNeutralButton("App permissions",(d,w)->startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())))).create();
        autoTrack.setOnCheckedChangeListener((button,on)->{dialog.dismiss();if(on)showConsent();else pauseTracking();});
        dialog.show();
    }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        device = prefs().getString("device", "");
        if (device.isEmpty()) { device = UUID.randomUUID().toString(); prefs().edit().putString("device", device).apply(); }
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.rgb(5,5,6));
        root.setOnApplyWindowInsetsListener((view, insets) -> { view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); return insets; });
        LinearLayout bar = new LinearLayout(this); bar.setPadding(dp(16),0,dp(8),0); bar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        logo = new ImageView(this); logo.setImageResource(R.drawable.rivo_mark); logo.setImportantForAccessibility(android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO); bar.addView(logo,new LinearLayout.LayoutParams(dp(24),dp(24)));
        status = new TextView(this); status.setText("Sign in to track"); status.setTextSize(14); status.setTextColor(Color.rgb(161,161,170)); status.setSingleLine(true); status.setEllipsize(android.text.TextUtils.TruncateAt.END); status.setGravity(android.view.Gravity.CENTER_VERTICAL); status.setPadding(dp(12),0,dp(8),0); status.setOnClickListener(v->showSettings()); status.setContentDescription("Tracking status. Opens Settings.");
        bar.addView(status, new LinearLayout.LayoutParams(0,dp(48),1));
        settingsButton = new ImageButton(this); settingsButton.setImageResource(android.R.drawable.ic_menu_preferences); settingsButton.setColorFilter(Color.rgb(244,244,245)); settingsButton.setBackgroundColor(Color.TRANSPARENT); settingsButton.setContentDescription("Settings"); settingsButton.setOnClickListener(v->showSettings()); bar.addView(settingsButton,new LinearLayout.LayoutParams(dp(48),dp(48))); root.addView(bar);
        web = new WebView(this); web.setBackgroundColor(Color.rgb(5,5,6)); root.addView(web,new LinearLayout.LayoutParams(-1,0,1)); setContentView(root);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,()->{if(web.canGoBack())web.goBack();else finish();});
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " RivoAndroid/0.2.1");
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (trusted(uri)) return false;
                if (request.isForMainFrame() && ("https".equals(uri.getScheme()) || "mailto".equals(uri.getScheme()) || "tel".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception e) { message("No app available to open this link"); }
                }
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (trusted(request.getUrl()) && "/api/auth/logout".equals(request.getUrl().getPath())) {
                    prefs().edit().putString("signedOutSession", sessionHash).apply();
                    stopService(new Intent(MainActivity.this, TrackingService.class)); driver = ""; message("Signed out — tracking stopped");
                }
                return null;
            }
            @Override public void onPageFinished(WebView view, String url) { CookieManager.getInstance().flush(); checkAccount(false); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null); fileCallback = callback;
                try { startActivityForResult(params.createIntent(), 301); return true; } catch (Exception e) { fileCallback = null; callback.onReceiveValue(null); return false; }
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, size) -> {
            if (!trusted(Uri.parse(url)) || !Uri.parse(url).getPath().startsWith("/api/")) { message("Download blocked: unexpected source"); return; }
            downloadUrl = url;
            Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("text/csv").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, "rivo-mileage-report.csv");
            startActivityForResult(save, 302);
        });
        web.loadUrl(Api.ORIGIN + "/driver");
    }
    private void showConsent() {
        if (driver.isEmpty()) { checkAccount(true); return; }
        new AlertDialog.Builder(this).setTitle("Automatic mileage")
            .setMessage("Rivo records all detected drives, including personal driving, while you stay signed in and its tracking service is running. It uses location while the screen is locked. An ongoing notification lets you pause.\n\nTrips are private until you submit business mileage. During an assigned delivery, dispatch and the customer tracking link receive your live delivery location.\n\nForce-stopping the app, restarting the phone or battery restrictions can stop tracking. Reopen Rivo and check the notification before driving.")
            .setPositiveButton("Enable tracking", (d, w) -> permissions())
            .setNegativeButton("Cancel", null)
            .setNeutralButton("Pause tracking", (d, w) -> {
                pauseTracking();
            }).show();
    }
    private void permissions() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            awaitingPermission = true; requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, 201); return;
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) { awaitingPermission = true; requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 202); return; }
        enable();
    }
    private void enable() {
        if (!foreground || driver.isEmpty()) { message("Sign in to enable tracking"); return; }
        final String expected = driver;
        network.execute(() -> {
            try {
                JSONObject me = Api.call("/api/me", null); JSONObject session = me.getJSONObject("session");
                if (!expected.equals(session.optString("driverId")) || !"driver".equals(session.optString("role"))) throw new Exception("Driver account changed. Sign in again.");
                Api.call("/api/mileage/consent", new JSONObject().put("enabled", true).put("deviceId", device).put("source", "android"));
                prefs().edit().putBoolean("paused", false).putString("consentedDriver", expected).remove("signedOutSession").remove("lastError").apply();
                expiresAt = Instant.parse(session.getString("expiresAt")).toEpochMilli(); main.post(this::startTracker);
            } catch (Exception e) { message(e.getMessage()); }
        });
    }
    private void startTracker() {
        if (!foreground || driver.isEmpty() || prefs().getBoolean("paused", true)) return;
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) { message("Allow precise location to resume automatic mileage"); return; }
        try {
            startForegroundService(new Intent(this, TrackingService.class).putExtra("driver", driver).putExtra("device", device).putExtra("expiresAt", expiresAt));
            message("Auto-track enabled · check tracking notification");
        } catch (Exception e) { message("Cannot start tracking; reopen Rivo and check location settings"); }
    }
    private void checkAccount(boolean explain) {
        if (checking || !foreground) return; checking = true;
        network.execute(() -> {
            try {
                JSONObject me = Api.call("/api/me", null), s = me.getJSONObject("session");
                if (!"driver".equals(s.optString("role"))) { driver = ""; stopService(new Intent(this, TrackingService.class)); message("Driver sign-in required for mileage tracking"); return; }
                driver = s.getString("driverId"); expiresAt = Instant.parse(s.getString("expiresAt")).toEpochMilli();
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(s.getString("token").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                sessionHash = android.util.Base64.encodeToString(digest, android.util.Base64.NO_WRAP);
                JSONObject t = me.getJSONObject("snapshot").getJSONObject("mileage").getJSONObject("tracking");
                boolean allowed = t.optBoolean("enabled") && device.equals(t.optString("deviceId")) && driver.equals(prefs().getString("consentedDriver", "")) && !prefs().getBoolean("paused", true) && !sessionHash.equals(prefs().getString("signedOutSession", ""));
                if (allowed) main.post(this::startTracker);
                else { stopService(new Intent(this, TrackingService.class)); message("Mileage paused · open Settings to enable Auto-track"); }
                if (explain) main.post(this::showConsent);
            } catch (Api.Failure e) {
                if (e.code == 401 || e.code == 403) { driver = ""; stopService(new Intent(this, TrackingService.class)); message("Sign in as a driver to enable mileage tracking"); }
                else message("Cannot verify account right now — check connection");
            } catch (Exception e) { message("Offline — open the notification to check tracking"); }
            finally { checking = false; }
        });
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (!awaitingPermission) return; awaitingPermission = false;
        if (code == 201) { if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) permissions(); else message("Precise location is required; tracking stays off"); }
        if (code == 202) { if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) enable(); else message("Enable notifications so you can see and pause tracking"); }
    }
    @Override protected void onActivityResult(int code, int result, Intent intent) {
        super.onActivityResult(code, result, intent);
        if (code == 301 && fileCallback != null) { fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, intent)); fileCallback = null; }
        if (code == 302 && result == RESULT_OK && intent != null && intent.getData() != null) {
            final Uri target = intent.getData(); final String source = downloadUrl;
            network.execute(() -> {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(source).openConnection(); c.setConnectTimeout(12000); c.setReadTimeout(12000); c.setInstanceFollowRedirects(false);
                    c.setRequestProperty("Cookie", CookieManager.getInstance().getCookie(Api.ORIGIN));
                    try { if (c.getResponseCode() != 200) throw new IOException("Sign in and retry the export"); try (InputStream in = c.getInputStream(); OutputStream out = getContentResolver().openOutputStream(target)) { if (out == null) throw new IOException("Cannot write file"); byte[] buffer = new byte[8192]; int n; while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n); } } finally { c.disconnect(); }
                    message("Report saved to your chosen location");
                } catch (Exception e) { message("Export failed: " + e.getMessage()); }
            });
        }
    }
    @Override protected void onResume() { super.onResume();
        if (android.animation.ValueAnimator.areAnimatorsEnabled()) { logoAnimation = android.animation.ObjectAnimator.ofFloat(logo,android.view.View.ROTATION,0f,360f); logoAnimation.setDuration(20000); logoAnimation.setRepeatCount(android.animation.ValueAnimator.INFINITE); logoAnimation.setInterpolator(new android.view.animation.LinearInterpolator()); logoAnimation.start(); }
        foreground = true; main.removeCallbacks(appearancePoll);main.post(appearancePoll); main.removeCallbacks(poll); main.post(poll); }
    @Override protected void onPause() { foreground = false; if(logoAnimation != null)logoAnimation.cancel(); main.removeCallbacks(appearancePoll); main.removeCallbacks(poll); CookieManager.getInstance().flush(); super.onPause(); }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { foreground = false; main.removeCallbacks(appearancePoll); main.removeCallbacks(poll); if (fileCallback != null) fileCallback.onReceiveValue(null); network.shutdown(); web.destroy(); super.onDestroy(); }
}
