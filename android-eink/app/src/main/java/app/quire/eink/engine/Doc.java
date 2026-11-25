package app.quire.eink.engine;

import android.graphics.Bitmap;
import android.graphics.Color;

import com.artifex.mupdf.fitz.ColorSpace;
import com.artifex.mupdf.fitz.Context;
import com.artifex.mupdf.fitz.Document;
import com.artifex.mupdf.fitz.Matrix;
import com.artifex.mupdf.fitz.Outline;
import com.artifex.mupdf.fitz.Page;
import com.artifex.mupdf.fitz.Pixmap;
import com.artifex.mupdf.fitz.Rect;
import com.artifex.mupdf.fitz.android.AndroidDrawDevice;

import java.util.ArrayList;
import java.util.List;

/** Thin MuPDF wrapper. NOT thread-safe: use from one worker thread only. */
public final class Doc {
    public static final float DPI = 212f;   // panel density; layout units are points (1/72")
    private final Document doc;
    private final int w, h;
    public final boolean reflowable;
    private int pages;
    private int[] gray;                      // scratch for gray -> ARGB expansion

    public Doc(String path, int w, int h, float emPt) {
        Context.init();
        this.w = w; this.h = h;
        doc = Document.openDocument(path);
        reflowable = doc.isReflowable();
        if (reflowable) layout(emPt);
        pages = doc.countPages();
    }

    /** Re-flow at font size emPt (points). Page count changes. */
    public void layout(float emPt) {
        if (!reflowable) return;
        doc.layout(w * 72f / DPI, h * 72f / DPI, emPt);
        pages = doc.countPages();
    }

    /** Typography override (reflowable only). Applies to documents laid out afterwards. */
    public static void setUserCss(String css) { Context.setUserCSS(css); }

    public int pageCount() { return pages; }

    /** Flattened table of contents: {title, level, pageIndex}. */
    public List<Object[]> toc() {
        List<Object[]> out = new ArrayList<>();
        Outline[] o = doc.loadOutline();
        if (o != null) walk(o, 0, out);
        return out;
    }

    private void walk(Outline[] items, int level, List<Object[]> out) {
        for (Outline it : items) {
            int p = -1;
            try { p = doc.pageNumberFromLocation(doc.resolveLink(it)); } catch (Throwable ignored) {}
            out.add(new Object[]{it.title, level, p});
            if (it.down != null) walk(it.down, level + 1, out);
        }
    }

    /** Render page n (0-based) fit into bmp. mode: "argb"/"565" draw direct; "gray" renders DeviceGray then expands. */
    public void render(int n, Bitmap bmp, String mode) {
        Page page = doc.loadPage(n);
        try {
            Rect b = page.getBounds();
            float pw = b.x1 - b.x0, ph = b.y1 - b.y0;
            float s = Math.min(w / pw, h / ph);
            float ox = (w - pw * s) / 2f, oy = (h - ph * s) / 2f;
            Matrix m = new Matrix(s, 0, 0, s, ox - b.x0 * s, oy - b.y0 * s);
            if ("gray".equals(mode)) {
                Pixmap pm = page.toPixmap(m, ColorSpace.DeviceGray, false);
                try { blitGray(pm, bmp); } finally { pm.destroy(); }
            } else {
                bmp.eraseColor(Color.WHITE);
                AndroidDrawDevice dev = new AndroidDrawDevice(bmp, 0, 0, 0, 0, w, h);
                try { page.run(dev, m); dev.close(); } finally { dev.destroy(); }
            }
        } finally { page.destroy(); }
    }

    private void blitGray(Pixmap pm, Bitmap bmp) {
        int pw = pm.getWidth(), ph = pm.getHeight(), x0 = pm.getX(), y0 = pm.getY();
        byte[] s = pm.getSamples();
        bmp.eraseColor(Color.WHITE);
        if (gray == null || gray.length < pw) gray = new int[pw];
        for (int y = 0; y < ph; y++) {
            int by = y + y0;
            if (by < 0 || by >= bmp.getHeight()) continue;
            int o = y * pw;
            for (int x = 0; x < pw; x++) { int g = s[o + x] & 0xff; gray[x] = 0xff000000 | g << 16 | g << 8 | g; }
            bmp.setPixels(gray, 0, pw, x0, by, Math.min(pw, bmp.getWidth() - x0), 1);
        }
    }

    public void close() { doc.destroy(); }
}
