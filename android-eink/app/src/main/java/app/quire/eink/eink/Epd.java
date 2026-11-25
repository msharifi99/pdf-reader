package app.quire.eink.eink;

import android.util.Log;
import android.view.View;

import java.lang.reflect.Method;

/**
 * Wrapper for the Boyue/Rockchip e-ink refresh API baked into this device's framework.jar:
 *   boolean android.view.View.requestEpdMode(android.view.View$EINK_MODE mode, boolean force)
 * EINK_MODE values seen: EPD_FULL, EPD_PART, EPD_A2, EPD_AUTO, EPD_TEXT, EPD_BLOCK, EPD_BLACK_WHITE,
 * EPD_DIRECT_A2, EPD_DIRECT_PART, EPD_FULL_DITHER, EPD_FULL_WIN, EPD_OED_PART, EPD_NULL, EPD_RESET,
 * EPD_STANDBY, EPD_POWEROFF. The mode is applied on the view's next draw, so callers invalidate afterwards.
 * Everything here is a logged no-op on devices without the API.
 */
public final class Epd {
    private static final String TAG = "QuireEpd";
    private static boolean inited;
    private static Method request;           // View.requestEpdMode(EINK_MODE, boolean)
    private static Class<?> modeClass;

    private Epd() {}

    private static synchronized void init() {
        if (inited) return;
        inited = true;
        try {
            modeClass = Class.forName("android.view.View$EINK_MODE");
            request = View.class.getMethod("requestEpdMode", modeClass, boolean.class);
            Log.i(TAG, "vendor e-ink API found: " + request);
        } catch (Throwable t) {
            Log.w(TAG, "vendor e-ink API missing; refresh calls are no-ops (" + t + ")");
        }
    }

    public static boolean available() { init(); return request != null; }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static boolean mode(View v, String name, boolean force) {
        init();
        if (request == null) return false;
        try {
            Object m = Enum.valueOf((Class<Enum>) modeClass, name);
            Object r = request.invoke(v, m, force);
            Log.i(TAG, "requestEpdMode(" + name + "," + force + ") -> " + r);
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "requestEpdMode(" + name + ") failed: " + t);
            return false;
        }
    }

    /** Flashing full-panel refresh (clears ghosting). Invalidates the view. Call on the UI thread. */
    public static void fullRefresh(final View v) {
        if (!mode(v, "EPD_FULL", true)) return;
        v.invalidate();
        // The mode sticks on the view; drop back to partial shortly after (no invalidate: applies at the next draw).
        v.postDelayed(new Runnable() { public void run() { mode(v, "EPD_PART", false); } }, 400);
    }

    /** Normal partial refresh (default resting mode). */
    public static void partial(View v) {
        if (mode(v, "EPD_PART", false)) v.invalidate();
    }

    /** Fast low-quality mode for scrolling/animation (A2), or back to partial when off. */
    public static void fastMode(View v, boolean on) {
        mode(v, on ? "EPD_A2" : "EPD_PART", false);
    }
}
