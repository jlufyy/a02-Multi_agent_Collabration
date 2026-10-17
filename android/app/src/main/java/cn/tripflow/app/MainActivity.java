package cn.tripflow.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;
import java.net.HttpURLConnection;
import java.net.URL;

/** Native lifecycle, location consent and WebView around the on-device TripFlow runtime. */
public class MainActivity extends Activity {
    private static final String ORIGIN = "http://127.0.0.1:18761";
    private static final int LOCATION_REQUEST = 42;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private NativeSpeech speech;
    private TextView status;
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;
    private boolean destroyed;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(244, 247, 251));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        status = new TextView(this);
        status.setText("TripFlow\n正在启动手机上的旅行规划服务…");
        status.setTextColor(Color.rgb(29, 59, 110));
        status.setTextSize(18);
        status.setGravity(android.view.Gravity.CENTER);
        root.addView(status, new LinearLayout.LayoutParams(-1, -1));
        web = new WebView(this);
        web.setVisibility(View.GONE);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        root.requestApplyInsets();
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        speech = new NativeSpeech(getApplicationContext(), web);
        web.addJavascriptInterface(speech, "TripFlowSpeech");
        web.setWebViewClient(new WebViewClient() {
            @Override public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
                if (isLocal(Uri.parse(url))) getPreferences(MODE_PRIVATE).edit().putString("lastUrl", url).apply();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isLocal(uri)) return false;
                if (("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) && request.isForMainFrame()) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (android.content.ActivityNotFoundException ignored) { }
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!isLocal(Uri.parse(origin))) { callback.invoke(origin, false, false); return; }
                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                    return;
                }
                locationCallback = callback;
                locationOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_REQUEST);
            }
            @Override public void onGeolocationPermissionsHidePrompt() { locationCallback = null; }
        });
        startRuntime();
    }

    private static boolean isLocal(Uri uri) {
        return "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort() == 18761;
    }

    private void startRuntime() {
        new Thread(() -> {
            try {
                synchronized (MainActivity.class) {
                    if (!Python.isStarted()) Python.start(new AndroidPlatform(getApplicationContext()));
                }
                Python.getInstance().getModule("mobile_backend").callAttr("start", getApplicationContext());
                boolean ready = false;
                for (int attempt = 0; attempt < 90 && !destroyed; attempt++) {
                    HttpURLConnection connection = null;
                    try {
                        connection = (HttpURLConnection) new URL(ORIGIN + "/api/v1/health").openConnection();
                        connection.setConnectTimeout(1000);
                        connection.setReadTimeout(1000);
                        if (connection.getResponseCode() == 200) { ready = true; break; }
                    } catch (java.io.IOException ignored) {
                        Thread.sleep(300);
                    } finally { if (connection != null) connection.disconnect(); }
                }
                if (!ready) throw new IllegalStateException("runtime unavailable");
                handler.post(() -> {
                    if (destroyed) return;
                    status.setVisibility(View.GONE);
                    web.setVisibility(View.VISIBLE);
                    String previous = getPreferences(MODE_PRIVATE).getString("lastUrl", ORIGIN + "/");
                    web.loadUrl(isLocal(Uri.parse(previous)) ? previous : ORIGIN + "/");
                });
            } catch (Exception error) {
                // Do not copy exception messages: provider/runtime config could contain private values.
                android.util.Log.e("TripFlow", "Startup failed: " + error.getClass().getSimpleName());
                handler.post(() -> {
                    if (destroyed) return;
                    status.setText("启动暂时失败\n请点击重试");
                    status.setOnClickListener(v -> { status.setText("正在重新连接…"); startRuntime(); });
                });
            }
        }, "tripflow-startup").start();
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code == LOCATION_REQUEST && locationCallback != null) {
            boolean allowed = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            locationCallback.invoke(locationOrigin, allowed, false);
            locationCallback = null;
        }
    }

    @Override public void onBackPressed() {
        if (web == null) { moveTaskToBack(true); return; }
        web.evaluateJavascript("(function(){var ds=Array.from(document.querySelectorAll('[role=dialog]'));"
            + "ds.sort((a,b)=>(parseInt(getComputedStyle(b).zIndex)||0)-(parseInt(getComputedStyle(a).zIndex)||0));"
            + "var b=ds[0]?.querySelector('button[aria-label=关闭],button[aria-label=返回]');"
            + "if(b){b.click();return true;}return false;})()", handled -> {
                if ("true".equals(handled)) return;
                if (web.canGoBack()) web.goBack(); else moveTaskToBack(true);
            });
    }
    @Override protected void onPause() { super.onPause(); if (web != null) web.onPause(); if (speech != null) speech.stop(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        if (speech != null) speech.close();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
