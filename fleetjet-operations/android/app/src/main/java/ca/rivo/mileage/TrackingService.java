package ca.rivo.mileage;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import org.json.*;
import java.time.Instant;
import java.util.concurrent.*;

public final class TrackingService extends Service implements LocationListener {
    static final String PAUSE = "ca.rivo.mileage.PAUSE";
    static final String CHANNEL = "rivo-mileage";
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    private LocationManager location;
    private PointStore points;
    private volatile String driver = "", device = "";
    private volatile long expiresAt = 0, lastSaved = 0;
    private volatile boolean stopped = false;
    static android.content.SharedPreferences prefs(Context c) { return c.getSharedPreferences("tracker", MODE_PRIVATE); }
    public void onCreate() {
        super.onCreate(); points = new PointStore(this);
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL, "Automatic mileage tracking", NotificationManager.IMPORTANCE_LOW));
    }
    private Notification notification(String text) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent pause = PendingIntent.getService(this, 1, new Intent(this, TrackingService.class).setAction(PAUSE), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.rivo_mark).setContentTitle("Rivo mileage tracking").setContentText(text).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).addAction(new Notification.Action.Builder(null, "Pause", pause).build()).build();
    }
    private void notice(String text) { if (!stopped) getSystemService(NotificationManager.class).notify(41, notification(text)); }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && PAUSE.equals(intent.getAction())) {
            prefs(this).edit().putBoolean("paused", true).apply();
            worker.execute(() -> { try { Api.call("/api/mileage/consent", new JSONObject().put("enabled", false).put("deviceId", device)); } catch (Exception ignored) { /* local pause is immediate, even offline */ } });
            stopSelf(); return START_NOT_STICKY;
        }
        startForeground(41, notification("Starting GPS — all detected drives stay private until submitted"));
        if (intent == null || intent.getStringExtra("driver") == null) { stopSelf(); return START_NOT_STICKY; }
        String nextDriver = intent.getStringExtra("driver");
        if (!driver.isEmpty()) { if (!driver.equals(nextDriver)) stopSelf(); return START_NOT_STICKY; }
        driver = nextDriver; device = intent.getStringExtra("device"); expiresAt = intent.getLongExtra("expiresAt", 0);
        if (prefs(this).getBoolean("paused", true) || System.currentTimeMillis() >= expiresAt || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) { stopSelf(); return START_NOT_STICKY; }
        location = (LocationManager) getSystemService(LOCATION_SERVICE);
        try {
            location.requestLocationUpdates(LocationManager.GPS_PROVIDER, 10000, 0, this, Looper.getMainLooper());
            worker.scheduleWithFixedDelay(this::sync, 0, 20, TimeUnit.SECONDS);
            notice("Ready to detect driving · tap to review · Pause anytime");
        } catch (SecurityException | IllegalArgumentException e) { stopSelf(); }
        return START_NOT_STICKY;
    }
    @Override public void onLocationChanged(Location fix) {
        if (stopped || driver.isEmpty() || System.currentTimeMillis() >= expiresAt) { stopSelf(); return; }
        if (fix.isFromMockProvider() || System.currentTimeMillis() - lastSaved < 8000 || fix.getAccuracy() > 60 || Math.abs(System.currentTimeMillis() - fix.getTime()) > 60000) return;
        lastSaved = System.currentTimeMillis();
        worker.execute(() -> { if (stopped) return; try { points.add(driver, fix); } catch (Exception e) { prefs(this).edit().putString("lastError", e.getMessage()).apply(); stopSelf(); } });
    }
    private void sync() {
        if (stopped || System.currentTimeMillis() >= expiresAt) { stopSelf(); return; }
        try {
            JSONObject me = Api.call("/api/me", null), session = me.getJSONObject("session");
            if (!"driver".equals(session.optString("role")) || !driver.equals(session.optString("driverId"))) { stopSelf(); return; }
            JSONObject status = me.getJSONObject("snapshot").getJSONObject("mileage").getJSONObject("tracking");
            if (!status.optBoolean("enabled") || !device.equals(status.optString("deviceId"))) { prefs(this).edit().putBoolean("paused", true).apply(); stopSelf(); return; }
            expiresAt = Instant.parse(session.getString("expiresAt")).toEpochMilli();
            JSONArray batch = points.batch(driver);
            if (batch.length() > 0) {
                JSONObject result = Api.call("/api/mileage/points", new JSONObject().put("deviceId", device).put("points", batch));
                points.acknowledge(driver, result.getLong("ack"));
                notice(result.optInt("rejected") > 0 ? "GPS quality warning — review your trip" : "GPS connected · mileage saved automatically");
            } else if (System.currentTimeMillis() - lastSaved > 120000) notice("Waiting for GPS — check precise location is enabled");
        } catch (Api.Failure e) {
            if (e.code == 401 || e.code == 403) { prefs(this).edit().putString("lastError", "Sign in again to resume tracking").apply(); stopSelf(); }
            else notice("Saved on device · waiting to sync");
        } catch (Exception e) { notice("Offline · GPS fixes saved on this device"); }
    }
    @Override public void onProviderDisabled(String provider) { notice("GPS is off — turn Location on to record mileage"); }
    @Override public void onProviderEnabled(String provider) { notice("GPS enabled — waiting for a precise fix"); }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
    @Override public void onDestroy() {
        stopped = true;
        if (location != null) location.removeUpdates(this);
        worker.execute(() -> points.close()); worker.shutdown();
        stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
