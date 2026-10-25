package ca.rivo.mileage;

import android.webkit.CookieManager;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

final class Api {
    static final String ORIGIN = "https://app.floraljet.llc";
    static final class Failure extends IOException {
        final int code;
        Failure(int code, String message) { super(message); this.code = code; }
    }
    static JSONObject call(String path, JSONObject body) throws Exception {
        if (!path.startsWith("/api/")) throw new IOException("Invalid API path");
        HttpURLConnection connection = (HttpURLConnection) new URL(ORIGIN + path).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(12000); connection.setReadTimeout(12000);
        connection.setRequestProperty("Accept", "application/json");
        String cookie = CookieManager.getInstance().getCookie(ORIGIN);
        if (cookie != null) connection.setRequestProperty("Cookie", cookie);
        try {
            if (body != null) {
                connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = connection.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            }
            int code = connection.getResponseCode();
            InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String text = "";
            if (stream != null) try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) { byte[] buffer = new byte[8192]; int count; while ((count = in.read(buffer)) != -1) { out.write(buffer, 0, count); if (out.size() > 5_000_000) throw new IOException("Response too large"); } text = out.toString("UTF-8"); }
            JSONObject result;
            try { result = new JSONObject(text); } catch (Exception e) { throw new Failure(code, "Server response unavailable"); }
            if (code != 200 && code != 201) throw new Failure(code, result.optString("error", "Request failed"));
            return result;
        } finally { connection.disconnect(); }
    }
}
