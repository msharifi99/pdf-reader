package app.quire.eink;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Bundle;
import android.os.Debug;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import app.quire.eink.eink.Epd;
import app.quire.eink.eink.Keys;
import app.quire.eink.engine.Doc;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Spike: open a file (intent extra "path"; optional "fmt" argb|565|gray, "em" points), turn pages with keys/taps. */
public class MainActivity extends Activity {
    private static final String TAG = "QuireSpike";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Map<Integer, Bitmap> cache = new HashMap<>();   // worker-thread only
    private final Object lock = new Object();
    private Doc doc;
    private int w, h, page = -1, pages;
    private String fmt = "argb";
    private Bitmap shown;                  // guarded by lock
    private volatile long turnStart;
    private volatile boolean turnPrefetched;
    private Reader view;
    private int turns;

    private final class Reader extends View {
        Reader(Context c) { super(c); }
        @Override protected void onDraw(Canvas c) {
            Bitmap b; synchronized (lock) { b = shown; }
            if (b != null) c.drawBitmap(b, 0, 0, null);
            long ts = turnStart;
            if (ts != 0) {
                turnStart = 0;
                Log.i(TAG, "turn drawn: " + (SystemClock.elapsedRealtime() - ts) + " ms prefetched=" + turnPrefetched + " page=" + page);
            }
        }
    }

    @Override protected void onCreate(Bundle s) {
        super.onCreate(s);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        int f = WindowManager.LayoutParams.FLAG_FULLSCREEN | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD;
        getWindow().setFlags(f, f);
        DisplayMetrics dm = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getMetrics(dm);
        w = dm.widthPixels; h = dm.heightPixels;
        Log.i(TAG, "screen " + w + "x" + h + " density=" + dm.densityDpi + " heapClass=" + ((android.app.ActivityManager) getSystemService(ACTIVITY_SERVICE)).getMemoryClass() + "MB");
        view = new Reader(this);
        setContentView(view);
        final String path = getIntent().getStringExtra("path") != null ? getIntent().getStringExtra("path") : "/sdcard/QuireTest/text.pdf";
        if (getIntent().getStringExtra("fmt") != null) fmt = getIntent().getStringExtra("fmt");
        final float em = getIntent().getFloatExtra("em", 10f);
        final String css = getIntent().getStringExtra("css");
        Log.i(TAG, "Epd available=" + Epd.available());
        final long t0 = SystemClock.elapsedRealtime();
        worker.execute(new Runnable() { public void run() {
            try {
                if (css != null) Doc.setUserCss(css);
                doc = new Doc(path, w, h, em);
                pages = doc.pageCount();
                Log.i(TAG, "open+layout " + path + " fmt=" + fmt + ": " + (SystemClock.elapsedRealtime() - t0) + " ms, pages=" + pages + " reflowable=" + doc.reflowable);
                long t1 = SystemClock.elapsedRealtime();
                Log.i(TAG, "toc entries=" + doc.toc().size() + " in " + (SystemClock.elapsedRealtime() - t1) + " ms");
                long t2 = SystemClock.elapsedRealtime();
                show(0, false);
                Log.i(TAG, "first page render+show: " + (SystemClock.elapsedRealtime() - t2) + " ms; total to first page " + (SystemClock.elapsedRealtime() - t0) + " ms");
                logMem();
            } catch (Throwable t) { Log.e(TAG, "open failed: " + t, t); }
        }});
    }

    private void logMem() {
        Runtime r = Runtime.getRuntime();
        Log.i(TAG, "java heap used=" + (r.totalMemory() - r.freeMemory()) / 1024 + "KB native heap=" + Debug.getNativeHeapAllocatedSize() / 1024 + "KB");
    }

    private Bitmap render(int n) {
        Bitmap b = cache.get(n);
        if (b != null) return b;
        if (cache.size() >= 3) { // evict farthest page, reuse its bitmap
            int far = -1;
            for (int k : cache.keySet()) if (far < 0 || Math.abs(k - n) > Math.abs(far - n)) far = k;
            b = cache.remove(far);
        }
        if (b == null) b = Bitmap.createBitmap(w, h, "565".equals(fmt) ? Bitmap.Config.RGB_565 : Bitmap.Config.ARGB_8888);
        long t = SystemClock.elapsedRealtime();
        doc.render(n, b, fmt);
        Log.i(TAG, "render page " + n + ": " + (SystemClock.elapsedRealtime() - t) + " ms");
        cache.put(n, b);
        return b;
    }

    /** Runs on worker. Bitmaps shown are never evicted while on screen because eviction only picks the farthest of 3. */
    private void show(final int n, boolean timed) {
        boolean hit = cache.containsKey(n);
        Bitmap b = render(n);
        synchronized (lock) { shown = b; }
        page = n;
        turnPrefetched = hit;
        if (!timed) turnStart = SystemClock.elapsedRealtime();
        view.postInvalidate();
        if (n + 1 < pages) render(n + 1);   // prefetch next
        if (n % 5 == 4) logMem();
    }

    private void go(final int delta) {
        if (doc == null) return;
        turnStart = SystemClock.elapsedRealtime();
        worker.execute(new Runnable() { public void run() {
            int n = page + delta;
            if (n < 0 || n >= pages) { turnStart = 0; return; }
            if (++turns % 6 == 0) view.post(new Runnable() { public void run() { Epd.fullRefresh(view); } });   // sample policy: full refresh every 6 turns
            show(n, true);
        }});
    }

    @Override public boolean onKeyDown(int keyCode, KeyEvent e) {
        int d = Keys.pageDelta(keyCode);
        Log.i(TAG, "onKeyDown keyCode=" + keyCode + " delta=" + d);
        if (d != 0) { if (e.getRepeatCount() == 0) go(d); return true; }   // consume, volume keys included, only inside the reader
        return super.onKeyDown(keyCode, e);
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
        if (e.getAction() == MotionEvent.ACTION_UP) go(e.getX() < w / 3f ? -1 : 1);
        return true;
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        worker.execute(new Runnable() { public void run() { if (doc != null) doc.close(); } });
        worker.shutdown();
    }
}
