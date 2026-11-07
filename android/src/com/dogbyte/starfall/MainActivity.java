package com.dogbyte.starfall;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Gravity;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * STARFALL shell.
 *
 * The game (vanilla JS + Canvas, zero dependencies) is bundled under assets/
 * and served over https://appassets.androidplatform.net via WebViewAssetLoader,
 * giving it a secure context. Fully offline — no network permission, the game
 * itself never leaves the device. localStorage persists via DOM storage.
 *
 * device-truth-1 additions (2026-10-23) — the shell previously let two game
 * features silently lie on device:
 *  1. External links were dead taps: shop.js renders its itch.io buy links
 *     with target="_blank", but the shell had no WebChromeClient (so the
 *     popup window was never created) and shouldOverrideUrlLoading let the
 *     WebView try to "load" external URLs itself. Now: anything not on the
 *     local asset origin opens via ACTION_VIEW in the device browser, and
 *     target="_blank" windows are intercepted and routed the same way.
 *  2. Photo mode's <a download> went nowhere: a WebView without a
 *     DownloadListener drops downloads, yet the game announced "Shot saved"
 *     (plus a voice line). Photo mode now hands the PNG to the single-method
 *     StarfallNative bridge below when present; the write goes through
 *     MediaStore into Pictures/Starfall and the game only celebrates after
 *     the bridge calls back window.__sfPhotoResult(true, ...). On failure
 *     the callback carries the error and the game says so. The bridge is
 *     exposed only to this app's own bundled pages — the WebView loads
 *     nothing else — and exposes exactly one method.
 */
public class MainActivity extends Activity {
    private WebView web;
    private TextView status;
    private WebViewAssetLoader assetLoader;

    static final String APP_HOST = "appassets.androidplatform.net";
    static final String APP_URL = "https://" + APP_HOST + "/assets/index.html";

    private void showStatus(final String msg) {
        runOnUiThread(() -> {
            if (status == null) {
                status = new TextView(MainActivity.this);
                status.setTextColor(Color.WHITE);
                status.setBackgroundColor(Color.BLACK);
                status.setTextSize(16);
                status.setPadding(48, 48, 48, 48);
                status.setGravity(Gravity.CENTER);
            }
            status.setText(msg);
            setContentView(status);
        });
    }

    /** Local-origin guard: only the asset-loader host is served internally. */
    private static boolean isLocalUrl(Uri u) {
        if (u == null) return false;
        String scheme = u.getScheme();
        if (scheme == null) return true; // relative — WebView resolves it locally
        if ("about".equals(scheme) || "data".equals(scheme) || "blob".equals(scheme)
                || "file".equals(scheme) || "javascript".equals(scheme)) return true;
        return APP_HOST.equals(u.getHost());
    }

    /** Hand an external URL to the device browser. Never crashes the game. */
    private void openExternal(String url) {
        if (url == null) return;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException | SecurityException e) {
            // No handler on this device — swallow; a dead tap is still
            // better than taking the game down with it.
        }
    }

    private boolean routeIfExternal(Uri u) {
        if (isLocalUrl(u)) return false;
        openExternal(u.toString());
        return true;
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        showStatus("STARFALL starting\u2026");

        try {
            web = new WebView(this);
        } catch (Throwable t) {
            showStatus("WebView could not start on this device:\n" + t);
            return;
        }
        WebView.setWebContentsDebuggingEnabled(true);

        assetLoader = new WebViewAssetLoader.Builder()
                // The game page lives at /assets/index.html and its loaders use
                // paths like "assets/sprites/...", which resolve to
                // /assets/assets/... — this handler must be registered FIRST so
                // the longer prefix wins. Without it, every file-backed asset
                // (sprites, music, sfx, voice, backgrounds) 404s on-device and
                // the game silently falls back to procedural rendering/audio,
                // while js/css (single-assets paths) keep working.
                .addPathHandler("/assets/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // hail-pause-2: NEVER serve a cached copy of the game. The shell
        // previously used WebView's default cache mode, so after an
        // install-over update the WebView could keep running the previous
        // APK's bundled JS — including a build that predates a fix — while
        // everything else looked new. That is the device-only failure mode
        // behind "the hail still doesn't pause" after a sandbox-green fix:
        // the sandbox always loads fresh files, the phone did not. All
        // game assets are bundled and offline, so no-cache costs nothing.
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Required for onCreateWindow to fire for target="_blank" links.
        s.setSupportMultipleWindows(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return assetLoader.shouldInterceptRequest(r.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return routeIfExternal(r.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return routeIfExternal(Uri.parse(url));
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    showStatus("Page failed to load:\n" + e.getDescription());
                }
            }
        });

        /* target="_blank" (the shop's buy links): the platform would open a
         * new window — intercept its first navigation and send THAT to the
         * browser instead. The game opens no local _blank links; the temp
         * view's client applies the same local-origin guard regardless, and
         * the popup view itself never loads anything. */
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog,
                                          boolean isUserGesture, Message resultMsg) {
                WebView pop = new WebView(MainActivity.this);
                pop.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                        if (!isLocalUrl(r.getUrl())) openExternal(r.getUrl().toString());
                        return true; // the popup view itself never loads anything
                    }

                    @SuppressWarnings("deprecation")
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, String url) {
                        if (!isLocalUrl(Uri.parse(url))) openExternal(url);
                        return true;
                    }
                });
                WebView.WebViewTransport transport =
                        (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(pop);
                resultMsg.sendToTarget();
                return true;
            }
        });

        /* Any future http(s) download the game triggers goes to the browser
         * instead of the void. data:/blob: downloads can't be handed off
         * this way — photo mode doesn't use them anymore (bridge below). */
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url != null && (url.startsWith("http://") || url.startsWith("https://"))
                    && !isLocalUrl(Uri.parse(url))) {
                openExternal(url);
            }
        });

        web.addJavascriptInterface(new PhotoBridge(), "StarfallNative");

        setContentView(web);
        // hail-pause-2: drop any cache left by a previous install before
        // the first load, so no stale script survives an update.
        web.clearCache(true);
        web.loadUrl(APP_URL);
    }

    /**
     * Photo-save bridge — the shell's ONLY JavaScript interface.
     * savePhoto(base64Png, fileName): writes the PNG into Pictures/Starfall
     * via MediaStore (API 29+, no permission) or the app-specific Pictures
     * dir + media scan (API 26-28, also permission-free), then reports the
     * verdict to window.__sfPhotoResult(ok, errorString) on the UI thread.
     * @JavascriptInterface methods run on a background thread by design.
     */
    private class PhotoBridge {
        @JavascriptInterface
        public void savePhoto(final String base64Png, final String fileName) {
            new Thread(() -> {
                boolean ok = false;
                String err = "";
                try {
                    byte[] png = Base64.decode(base64Png, Base64.DEFAULT);
                    writePhoto(png, sanitize(fileName));
                    ok = true;
                } catch (Throwable t) {
                    err = t.getMessage() != null ? t.getMessage() : t.toString();
                }
                final boolean fOk = ok;
                final String fErr = err;
                runOnUiThread(() -> {
                    if (web != null) {
                        web.evaluateJavascript(
                                "window.__sfPhotoResult && window.__sfPhotoResult("
                                        + fOk + ", " + JSONObject.quote(fErr) + ")",
                                null);
                    }
                });
            }).start();
        }

        private String sanitize(String name) {
            if (name == null) name = "";
            name = name.replaceAll("[^A-Za-z0-9._-]", "_");
            if (name.isEmpty() || name.equals(".png")) name = "starfall-photo.png";
            if (!name.toLowerCase().endsWith(".png")) name += ".png";
            return name;
        }

        private void writePhoto(byte[] png, String name) throws Exception {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Scoped storage: MediaStore insert, zero permissions.
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                v.put(MediaStore.Images.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/Starfall");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("MediaStore insert refused");
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new Exception("MediaStore stream refused");
                    out.write(png);
                }
                v.clear();
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(uri, v, null, null);
            } else {
                // API 26-28: app-specific external Pictures needs no
                // permission either; scan it so gallery apps pick it up.
                File dir = new File(
                        getExternalFilesDir(Environment.DIRECTORY_PICTURES), "Starfall");
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new Exception("could not create Pictures/Starfall");
                }
                File f = new File(dir, name);
                try (FileOutputStream out = new FileOutputStream(f)) {
                    out.write(png);
                }
                MediaScannerConnection.scanFile(MainActivity.this,
                        new String[]{f.getAbsolutePath()},
                        new String[]{"image/png"}, null);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
