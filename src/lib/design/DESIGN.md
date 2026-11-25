# Quire design language

Quire should read like a well-set book sitting in a quiet Windows 11 window. Every screen follows the rules below. If a rule gets in your way, ask the design owner (T2) before you work around it.

Live reference: `src/lib/ui/Gallery.svelte`. In dev, open `/src/lib/ui/gallery.html?theme=dark`. Screenshots are in `docs/design/gallery-<theme>.png`.

## 1. Principles

1. **The text is the interface.** In the reader, chrome exists only while you reach for it. Nothing moves, blinks or badges while you read.
2. **One accent per theme.** Accent marks the current thing: the primary button, selection, progress, focus and toggles that are on. Never use it for decoration, headings or icons at rest.
3. **Quiet surfaces.** Use 3 surface levels (`--bg`, `--surface`, `--surface-2`) and hairline borders. Don't use gradients, glass panels, coloured section backgrounds or drop shadows on flat content.
4. **Space before lines.** Separate groups with whitespace first, a `--border-soft` hairline second, and boxes last.
5. **Native, not web.** Follow Windows 11 metrics: 32px controls, 5–8px radii, Mica behind the title bar, caption buttons 46px wide, and the system red close hover.
6. **Calm motion.** 120–200 ms ease-out. Things fade and drift 4px at most. Nothing bounces, except the switch thumb's tiny overshoot.
7. **Keyboard first.** Every control is reachable, shows the one focus ring, and shows its shortcut (tooltip chip, menu column).

**Don't:** use purple or blue gradients, glassmorphism on content, heavy shadows, emoji, coloured icon tiles, ALL-CAPS buttons, centred body text, more than one primary button per view, spinners for anything under 300 ms, or toasts for things the UI already shows.

## 2. Using the system

```ts
import '$lib/design/tokens.css';                       // once, at boot (also loads fonts.css)
import { themes, builtinThemes, applyTheme, followSystem, deriveTheme, isDark, themeVars, themeStyle,
         auditTheme, highlightColors, type AppTheme } from '$lib/design/themes';
import { bundledFonts, defaultTypography, typographyLimits, resolveFont, systemFont, typographyStyle } from '$lib/design/fonts';
import { fade, fadeScale, slide, reducedMotion, durations } from '$lib/design/motion';
import { contrast, mix, ensureContrast } from '$lib/design/color';
import { Button, IconButton, Icon, Menu, Dialog, toast, ... } from '$lib/ui';
```

(There is no `$lib` alias yet. Use relative paths until T1 adds one.)

- **Theme.** `await applyTheme(theme)` writes the CSS variables onto `:root`. It cross-fades with the View Transitions API, or switches instantly under reduced motion. It returns `'light' | 'dark'` for the Mica variant, which the shell passes to the native window. `followSystem(light, dark, onApplied)` returns an unsubscribe function.
- **Engines.** Engines receive `theme` (an `AppTheme` is a `Theme` from `engines/types.ts`). `theme.highlight[0..3]` holds yellow, green, blue and pink. Draw highlight overlays over fixed-layout pages with `mix-blend-mode: var(--hl-blend)` (`theme.highlightBlend`): multiply on light themes, screen on dark ones.
- **Shell attributes on `<html>`:**
  - `data-mica`: the body becomes transparent so Mica shows through.
  - `data-chrome-hidden`: every `[data-chrome]` element fades out.
  - `data-reduce-motion="on"`: the in-app reduce-motion toggle.
  - `data-theme`, `data-theme-kind`: set by `applyTheme`.
- **Colours in components** come from tokens only. The one exception is the Windows caption close hover, `#c42b1c`.

## 3. Tokens

### Colour roles (per theme)

| Token | Use |
|---|---|
| `--bg` | window and reading page |
| `--surface` | sidebars, dialogs, cards behind content |
| `--surface-2` | inputs, buttons (secondary), flyouts (`--flyout-bg`) |
| `--border` / `--border-soft` / `--border-strong` | hairlines; soft for dividers inside panels; strong for control outlines |
| `--text` | body and labels |
| `--muted` | secondary text and icons at rest. Must reach 4.5:1 (Solarized excepted, see below) |
| `--faint` | placeholders and disabled. Never for information |
| `--accent` / `--on-accent` / `--accent-soft` | primary, selection, focus / text on accent / tinted backgrounds of pressed toggles |
| `--hover` / `--pressed` / `--selected` | state overlays (transparent mixes of text/accent) |
| `--link`, `--selection`, `--hl-yellow/green/blue/pink`, `--danger`, `--success` | as named |
| `--chrome-bg` | title bar, toolbars, reader overlays: 82% `--bg` over Mica, with `backdrop-filter: blur(20px)` |
| `--scrim` | modal backdrop |

**Themes:** Dark (default, `#1b1c1f` with warm `#e8e4dc` text and amber accent), Solarized Light (canonical base3/base00, orange accent, blue links), Light, Sepia and OLED Black. Every theme passes WCAG AA for text and muted text, accent ≥ 3:1, and text over every highlight and the selection. **Exception:** Solarized Light keeps the canonical base00 at the user's request (4.1:1). Its muted text is 3.25:1 and is only for non-essential metadata. `themes.test.ts` enforces all of this. `deriveTheme()` builds custom themes and guarantees AA for every role.

### Spacing (4px base)

`--space-1` 4, `-1-5` 6, `-2` 8, `-2-5` 10, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-10` 40, `-12` 48, `-16` 64, `-20` 80, `-24` 96.

- Inside controls: 8–12.
- Between related controls: 8–16.
- Between groups: 24–32.
- Between page sections: 48–64.
- Page gutters: 40 (library), 24 (panels).

### Radii

| Token | Size | Use |
|---|---|---|
| `--radius-xs` | 3 | kbd, tags, checkbox |
| `--radius-sm` | 5 | buttons, inputs, menu items, list rows |
| `--radius-md` | 8 | menus, popovers, covers, toasts |
| `--radius-lg` | 12 | dialogs, large panels |
| `--radius-full` | – | switches, rings, swatches |

Nested radius = outer radius minus padding.

### Type

The UI uses **Inter** (`--font-ui`) at 13px by default. Literata is the display face (`--font-display`), used only for book titles, generated covers, the library greeting and page-level empty states. Reading text uses the Typography Profile.

| Token | Size | Use |
|---|---|---|
| `--text-2xs` | 11 | kbd, badges, section labels (uppercase, `--tracking-caps`, semibold, muted) |
| `--text-xs` | 12 | captions, metadata, tooltips |
| `--text-sm` | 13 | default UI: buttons, menus, settings rows |
| `--text-md` | 14 | inputs, list primary text |
| `--text-lg` | 16 | dialog and panel titles (semibold) |
| `--text-xl` | 20 | page titles |
| `--text-2xl` | 26 | library greeting (display) |
| `--text-3xl` | 34 | rare |

- Weights: 400 / 500 for labels and buttons / 600 for titles. Never use bold 700 in the UI.
- Use `.tabular` for page numbers, percentages and times.

**Reading defaults** (`defaultTypography`): Literata 19px, line-height 1.6, paragraph spacing 0.6em, no indent, left aligned, hyphenation on, measure 66ch, 6% side margins, columns auto. Bundled fonts: Literata, Source Serif 4 (serif), Inter (sans), Atkinson Hyperlegible Next (legibility) and JetBrains Mono (mono). Installed fonts go through `systemFont(name)` / `resolveFont(choice)`.

### Elevation

| Token | Use |
|---|---|
| `--shadow-1` | segmented indicator, slider thumb |
| `--shadow-2` | tooltips |
| `--shadow-3` | menus, popovers, toasts |
| `--shadow-4` | dialogs |
| `--shadow-cover` / `--shadow-cover-hover` | book covers |

Every floating surface also gets a 1px `--border`, because dark themes rely on the border more than the shadow. Flat content never has a shadow.

### Motion

| Token | Duration | Use |
|---|---|---|
| `--dur-instant` | 80 | press scale (0.98, icon buttons 0.94) |
| `--dur-fast` | 120 | hover, colour, chrome fade-*in* |
| `--dur-base` | 160 | menus, popovers, toggles, segmented indicator |
| `--dur-slow` | 200 | dialogs, sidebars, theme cross-fade, progress fill, cover lift |
| `--dur-chrome` | 200 | chrome fade-*out*, after `--chrome-hide-delay` 2000 ms |

- Easings:
  - `--ease-out` (default) for things arriving.
  - `--ease-in` for leaving.
  - `--ease-in-out` for moving across the screen.
  - `--ease-spring` for the switch thumb only.
- Svelte transitions in `motion.ts`:
  - `fade`: chrome, scrims.
  - `fadeScale`: popovers and toasts. Drifts 4px from the anchored side and scales from 0.98.
  - `slide`: sidebars. Travels 24px, never full width.
- Popover-based components animate in CSS with `@starting-style`.
- Reduced motion (OS setting or `data-reduce-motion="on"`) sets every duration to 0. The spinner slows, and the shimmer and indeterminate bars stop.

### Layers

| Token | Value |
|---|---|
| `--z-content-overlay` | 10 |
| `--z-chrome` | 100 |
| `--z-sidebar` | 200 |
| `--z-dropdown` | 300 |
| `--z-popover` | 400 |
| `--z-scrim` | 500 |
| `--z-modal` | 600 |
| `--z-toast` | 700 |
| `--z-tooltip` | 800 |

Popovers, menus, tooltips and dialogs live in the browser **top layer** (Popover API / `<dialog>`), so `overflow` never clips them.

### Focus

There is one focus ring: `outline: 2px solid var(--accent)` with a 2px offset, shown on `:focus-visible` only. Inside list rows and menus, use offset -2px. On covers, the ring wraps the cover at offset 3px. Inputs show focus as a strong border plus a 2px accent underline, Fluent-style. Never remove a focus ring without replacing it.

### High contrast

Under `forced-colors: active`, the tokens map to system colours (Canvas, CanvasText, Highlight, LinkText, GrayText) with `!important`, which overrides the inline theme variables. Shadows go away and controls get 1px borders. Test with a Windows contrast theme.

## 4. Iconography

- 20×20 grid, 1.5px stroke, round caps and joins, 1.75px safe margin, outline only.
- Fill is allowed only for state: `bookmark-filled`, the half of `theme`, and the `more` dots.
- Render at 20 in toolbars and 16 in menus, inputs and dense chrome. Never scale to odd sizes.
- Icons are `currentColor`: `--muted` at rest and `--text` on hover. Pressed toggles use `--accent`.
- Add new icons to `src/lib/ui/icons.ts` on the same grid. No icon fonts, no emoji, no third-party sets.
- Every icon-only button needs a label (`IconButton label=` gives you aria-label plus a tooltip).

## 5. Chrome that fades

The shell sets `<html data-chrome-hidden>` 2 s after the last pointer move or key press, in the reader only, and never while a menu, popover, dialog or focused control in the chrome is active. Mark chrome with `data-chrome="top" | "bottom" | ""`. When hidden, chrome fades to 0 over 200 ms, drifts 4px toward its edge, and the cursor hides. Any input brings it back in 120 ms. The progress line is not chrome: it stays visible at 2px. In focus mode it hides too.

## 6. Components (`src/lib/ui`)

| Component | Key props | Notes |
|---|---|---|
| `Button` | `variant` primary/secondary/ghost/subtle/danger, `size` sm/md/lg, `icon`, `iconEnd`, `loading`, `full` | One primary per view. Dialog footers: subtle "Cancel", then primary. |
| `IconButton` | `icon`, `label`*, `shortcut`, `pressed`, `size`, `variant` ghost/subtle/solid, `tooltipPlacement` | Built-in tooltip with a shortcut chip. |
| `Icon` | `name`, `size`, `label` | Decorative unless it has a `label`. |
| `Tooltip` | `text`, `shortcut`, `placement`, `delay` (500) | Shows instantly when moving between neighbours. Sets aria-describedby on the trigger. |
| `Kbd` | `keys` ("Ctrl+K", "g g"), `variant` chip/plain | `parseShortcut()` exported. |
| `Menu` | `items: MenuItem[]`, `label`, `placement`, `trigger(attrs)` snippet | Spread `attrs` on your button. Supports arrows, Home/End, type-ahead and Esc. `onselect` should call `commands.execute`. |
| `ContextMenu` | `items` or `(target) => items` | Wraps content. Opens on right-click, Shift+F10 and the Menu key. |
| `MenuList` | `items`, `onclose` | The bare menu, used by both of the above. |
| `Popover` | `open` (bindable), `label`, `placement`, `trigger(attrs)`, `size`, `role`, `onopen` | Light dismiss, Esc and focus return. |
| `Dialog` | `open` (bindable), `title`, `description`, `size` sm/md/lg, `dismissible`, `footer` snippet | Native `<dialog>`: focus trap, Esc, focus return. Add `autofocus` to the field that should get focus first. |
| `toast()` + `ToastHost` | `toast(msg, { kind, action: {label, run}, duration })` | Mount ToastHost once. At most 3 toasts, bottom centre. Hover pauses them. Use them for undo, not for status. |
| `Switch` | `checked` (bindable), `label`, `description`, `hideLabel` | Settings rows: label on the left, switch on the right. |
| `Checkbox` | `checked`, `indeterminate`, `label`, `description` | |
| `Slider` | `value` (bindable), `min`/`max`/`step`, `label`, `format`, `oninput` (live) / `onchange` | Native range. Shows its value live. |
| `SegmentedControl` | `options [{value,label,icon,iconOnly}]`, `value`, `label`, `size` | Use for 2–5 mutually exclusive modes. |
| `Select` | `options`, `value`, `label`, `hideLabel`, `full` | Native select. Uses `appearance: base-select` to style the picker. |
| `TextField` | `value`, `label`*, `hint`, `error`, `icon`, `trailing` snippet, `multiline` | |
| `SearchField` | `value`, `placeholder`, `shortcut`, `onsubmit`, `onescape` | First Esc clears, second Esc calls `onescape`. |
| `Tabs` | `tabs [{id,label,count}]`, `value`, `children(value)` | Arrow-key navigation. Accent underline. |
| `ListBox` | `items`, `key`, `text`, `selected`, `item` snippet, `onactivate`, `itemHeight` (virtualise) | aria-activedescendant. Supports PageUp/PageDown and type-ahead. |
| `ProgressBar` | `value?` (missing = indeterminate), `variant` line/bar, `marks` | The `line` variant is the reading-progress hairline. |
| `ProgressRing` | `value`, `size`, `stroke`, `showValue` | |
| `Spinner`, `Skeleton` | `Skeleton cover / lines / width / height` | Skeletons for covers and lists, spinners for buttons. |
| `EmptyState` | `icon`, `title`, `description`, `actions`, `size` page/inline | |
| `ColorSwatch`, `ColorPicker` | `color`/`value`, `presets`, `against` (live contrast readout) | For the theme editor and highlight colours. |
| `Card` | `title`, `author`, `cover`, `progress`, `format`, `meta`, `selected`, `missing`, `actions` snippet | 2:3 cover. Generates a typographic cover when there's no image. Progress hairline at the bottom, a check when finished. Lifts 3px on hover. |

\* required

## 7. Layouts

### Library home

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ◧ Quire        [⌕ Search or run a command        Ctrl K]        ◐ ⚙  ─ ▢ ✕ │ 40px chrome-bg over Mica
├───────────────────────────────────────────────────────────────────────────────┤
│  (40px gutter)                                                                │
│  Good evening                                          [⊞ ☰] [Sort ▾] [+ Add] │ display 26 / controls right
│                                                                               │
│  CONTINUE READING                                                             │ section label 11 caps
│  ┌──────┐  The Left Hand of Darkness        ┌──────┐  Saga, Volume One       │ wide tiles: cover 96px
│  │cover │  Ursula K. Le Guin               │cover │  Vaughan & Staples       │ + title, author,
│  │      │  ━━━━━━━━──────── 42%            │      │  ━━━━━━━━━━──── 66%      │ progress bar, time left
│  └──────┘  Ch. 7 · 2 h 10 min left [Resume]└──────┘  Issue 4 · 12 min left    │ (max 3, horizontal)
│                                                                               │
│  ALL BOOKS · 248                         Collections: All  Fiction  Comics …  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                            │ Card grid
│  │    │ │    │ │    │ │    │ │    │ │    │ │    │   minmax(150px,1fr)        │ gap 32 row / 24 col
│  └━━──┘ └────┘ └───✓┘ └━━━─┘ └────┘ └────┘ └────┘                            │
│  Title  Title  Title  Title  Title  Title  Title                              │
│  Author Author Author Author Author Author Author                             │
└───────────────────────────────────────────────────────────────────────────────┘
```

Compact list (the `☰` toggle) is a virtualised ListBox with 52px rows:

```
│  ▯ The Left Hand of Darkness     Ursula K. Le Guin     EPUB   ━━━━── 42%   2 d ago │
│  ▯ Thinking, Fast and Slow       Daniel Kahneman       PDF    ━───── 8%    1 w ago │
```

The cover thumbnail is 28×42. Columns: title (medium), author (muted), format tag, progress, last read (muted, tabular).

### Reader: chrome visible (any input)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ← Library   The Left Hand of Darkness · Ch. 7     ☰ ⌕ 🔖 Aa ◐ ⋯   ─ ▢ ✕ │ data-chrome="top", chrome-bg
├───────────────────────────────────────────────────────────────────────────────┤
│ ┌ Contents ─────┐                                                             │ sidebar 300px, surface,
│ │ Contents|High.│        Chapter Seven                                        │ slide 24px from left
│ │ 1 Prologue    │                                                             │
│ │▌7 On the Ice  │        Lorem ipsum text set in the Typography Profile,      │ measure 66ch, centred
│ │ 8 …           │        centred in the page with generous margins…           │
│ └───────────────┘                                                             │
│                                                       Ch. 7 · 14 min left 42% │ data-chrome="bottom", muted 12
├━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━──────────────────────────────────────────┤ progress line 2px (always)
```

### Reader: chrome hidden (2 s idle)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                                                                               │ no title bar; Mica edge only
│                     Chapter Seven                                             │
│                     Text, and only text. Cursor hidden.                       │
│                                                                               │
├━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━──────────────────────────────────────┤ 2px line stays
```

### Command palette (Ctrl+K)

```
            ┌──────────────────────────────────────────────────┐  640px wide, 15vh from top,
            │ ⌕ zoom                                       Esc │  surface, radius-lg, shadow-4
            ├──────────────────────────────────────────────────┤  48px input, text-md
            │ READER                                           │  group labels 11 caps
            │▌⊕ Zoom in                               Ctrl  +  │  selected: --selected + accent pill
            │ ⊖ Zoom out                              Ctrl  −  │  match chars: text + weight 600,
            │ ↔ Fit width                                   W  │   the rest of the label muted
            │ ▯ Fit page                                    P  │  Kbd chips right-aligned
            ├──────────────────────────────────────────────────┤
            │ >commands  @books  #headings  /in-book    ↑↓ ↵   │  footer hints, 11 muted
            └──────────────────────────────────────────────────┘
```

The scrim is `--scrim`. It opens with a fadeScale from the top over 160 ms. Use `ListBox` for the results.

### Settings

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Settings                                                         ─ ▢ ✕ │
├──────────────┬───────────────────────────────────────────────────────────────┤
│ ⌕ Search     │  Appearance                                     (title 20)     │
│              │                                                                │
│ Appearance   │  THEME                                                          │
│ Reading      │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌ + ┐  theme tiles 96×64,   │
│ Typography   │  │Dark│ │Sol.│ │Lt  │ │Sep.│ │OLED│ │New│  mini page preview,   │
│ Shortcuts    │  └────┘ └────┘ └────┘ └────┘ └────┘ └───┘  selected = ring      │
│ Library      │  Follow Windows theme                                 [●──]   │ rows: 48px min, label +
│ Data         │  Light theme   [Solarized Light ▾]  Dark theme  [Dark ▾]      │ description left,
│ About        │  ───────────────────────────────────────────────────────────   │ control right
│              │  MOTION                                                         │
│ 220px nav,   │  Reduce motion           Follows Windows unless on      [──○]   │
│ ListBox rows │                                                                 │ content max 680px
└──────────────┴───────────────────────────────────────────────────────────────┘
```

Typography settings place a live preview (`typographyStyle(profile)`) to the right of the sliders. The preview always uses the current theme.
