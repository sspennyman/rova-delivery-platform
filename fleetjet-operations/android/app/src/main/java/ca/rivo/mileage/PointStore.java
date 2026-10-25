package ca.rivo.mileage;

import android.content.*;
import android.database.Cursor;
import android.database.sqlite.*;
import android.location.Location;
import org.json.*;

final class PointStore extends SQLiteOpenHelper {
    PointStore(Context c) { super(c, "private-mileage.db", null, 1); }
    public void onCreate(SQLiteDatabase db) { db.execSQL("CREATE TABLE points (seq INTEGER PRIMARY KEY AUTOINCREMENT, driver TEXT NOT NULL, payload TEXT NOT NULL)"); }
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }
    synchronized void add(String driver, Location location) throws Exception {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM points", null)) { c.moveToFirst(); if (c.getInt(0) >= 50000) throw new Exception("Storage queue full. Connect to sync before tracking again."); }
        JSONObject point = new JSONObject().put("at", location.getTime()).put("lat", location.getLatitude()).put("lng", location.getLongitude()).put("accuracy", location.getAccuracy()).put("speed", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
        ContentValues v = new ContentValues(); v.put("driver", driver); v.put("payload", point.toString());
        if (getWritableDatabase().insertOrThrow("points", null, v) < 0) throw new Exception("Cannot save GPS fix");
    }
    synchronized JSONArray batch(String driver) throws Exception {
        JSONArray points = new JSONArray();
        try (Cursor c = getReadableDatabase().query("points", new String[]{"seq", "payload"}, "driver=?", new String[]{driver}, null, null, "seq ASC", "100")) {
            while (c.moveToNext()) points.put(new JSONObject(c.getString(1)).put("seq", c.getLong(0)));
        }
        return points;
    }
    synchronized void acknowledge(String driver, long seq) { getWritableDatabase().delete("points", "driver=? AND seq<=?", new String[]{driver, String.valueOf(seq)}); }
}
