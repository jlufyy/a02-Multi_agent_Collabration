package cn.tripflow.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.util.Locale;
import org.json.JSONObject;

/** Narrow bridge: speech only; it never exposes files, credentials or arbitrary intents. */
public final class NativeSpeech {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final WebView web;
    private TextToSpeech tts;
    private boolean ready;

    NativeSpeech(Context context, WebView view) {
        web = view;
        tts = new TextToSpeech(context, status -> {
            if (status == TextToSpeech.SUCCESS) {
                ready = tts.setLanguage(Locale.SIMPLIFIED_CHINESE) >= TextToSpeech.LANG_AVAILABLE;
            }
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { event(id, "start"); }
            @Override public void onDone(String id) { event(id, "end"); }
            @Override public void onError(String id) { event(id, "error"); }
        });
    }
    @JavascriptInterface public void speak(String text, String id) {
        if (text == null || id == null || text.length() > 2000 || id.length() > 100) return;
        handler.post(() -> {
            if (!ready) { event(id, "error"); return; }
            int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
            if (result == TextToSpeech.ERROR) event(id, "error");
        });
    }
    @JavascriptInterface public void stop() { handler.post(() -> tts.stop()); }
    private void event(String id, String type) {
        handler.post(() -> web.evaluateJavascript("window.dispatchEvent(new CustomEvent('tripflow-speech',{detail:{id:"
            + JSONObject.quote(id) + ",type:" + JSONObject.quote(type) + "}}))", null));
    }
    void close() { ready = false; tts.stop(); tts.shutdown(); }
}
