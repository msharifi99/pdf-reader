package app.quire.eink.eink;

import android.view.KeyEvent;

/** Maps hardware keys to page turns. Device sends PAGE_UP(92)/PAGE_DOWN(93); others are for other e-readers. */
public final class Keys {
    private Keys() {}

    /** @return +1 next page, -1 previous page, 0 not a page-turn key. */
    public static int pageDelta(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_PAGE_DOWN:
            case KeyEvent.KEYCODE_VOLUME_DOWN:
            case KeyEvent.KEYCODE_DPAD_RIGHT:
            case KeyEvent.KEYCODE_DPAD_DOWN:
                return 1;
            case KeyEvent.KEYCODE_PAGE_UP:
            case KeyEvent.KEYCODE_VOLUME_UP:
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_DPAD_UP:
                return -1;
            default:
                return 0;
        }
    }
}
