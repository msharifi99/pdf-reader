/**
 * Engine contract (SPEC "Engines", "Locators and anchors").
 *
 * Every format family (PDF, reflowable ebooks, comics/images) implements `Engine`. The reader
 * shell, annotations, search, progress and read-aloud talk only to this interface and never
 * branch on format. Engines must not import UI code.
 *
 * Conventions
 * - All `Promise`/`AsyncIterable` methods reject with `EngineError` (see bottom of file).
 * - Page numbers in `Locator { kind: 'fixed' }` are 0-based.
 * - Lengths in `Rect` are CSS pixels, relative to the `render()` target element's top-left.
 * - `fraction` is always 0..1 across the whole book.
 */

// ---------------------------------------------------------------------------------------------
// Formats and sources
// ---------------------------------------------------------------------------------------------

/** Concrete file format, as found by `sniff.ts` (magic bytes, never the extension). */
export type BookFormat =
  | 'pdf'
  | 'epub'
  | 'mobi'
  | 'azw3'
  | 'fb2'
  | 'fbz'
  | 'cbz'
  | 'cbr'
  | 'image';

/** Which engine family handles a format. */
export type EngineKind = 'pdf' | 'reflow' | 'comic';

/** Layout family. `fixed`: pages have a fixed geometry (PDF, comics). `reflowable`: text flows. */
export type LayoutKind = 'fixed' | 'reflowable';

/**
 * What an engine opens. Large files are never read whole into JS: `url` is a Range-capable URL
 * (`fileUrl(...)` from core.ts, i.e. `quire://` in the app, `/fixtures/...` in fake mode).
 */
export type BookSource =
  | {
      kind: 'file';
      /** Range-capable URL of the document. */
      url: string;
      format: BookFormat;
      /** Original file name, for titles when metadata is missing. */
      fileName?: string;
      /** Total size in bytes, if known. */
      byteLength?: number;
    }
  | {
      /** A folder of images (listed by the Rust core) or several loose image files. */
      kind: 'images';
      urls: string[];
      names: string[];
      format: 'image';
    };

export interface OpenOptions {
  /** Abort opening (e.g. the user closed the book while it loaded). */
  signal?: AbortSignal;
  /**
   * Called when the document is encrypted. Resolve with the password, or `null` to give up
   * (open() then rejects with code `password-cancelled`). `retry` is true after a wrong password.
   */
  requestPassword?: (retry: boolean) => Promise<string | null>;
}

// ---------------------------------------------------------------------------------------------
// Locators and anchors
// ---------------------------------------------------------------------------------------------

/** Engine-neutral position. Stored in the DB as JSON, so it must stay plain data. */
export type Locator =
  | {
      kind: 'fixed';
      /** 0-based page (PDF, comic, image). */
      page: number;
      /** Vertical offset within the page, 0..1 of page height (0 = top). */
      y?: number;
    }
  | {
      kind: 'reflow';
      /** EPUB CFI (foliate-js). */
      cfi: string;
      /** 0..1 of the whole book. */
      fraction: number;
    };

/** A stable reference to a span of text, used by highlights, notes, bookmarks. */
export interface Anchor {
  locator: Locator;
  /** Re-anchoring fallback: fuzzy-matched near `locator` when the primary reference fails. */
  quote: { exact: string; prefix: string; suffix: string };
  /** PDF text quads in page space (PDF points, origin top-left), one per line fragment. */
  pdfQuads?: number[][];
  /** Reflowable range CFI. */
  cfiRange?: string;
}

/** A span between two Locators (for `getText`). */
export interface TextRange {
  from: Locator;
  to: Locator;
}

/** Axis-aligned rect in CSS px relative to the render target's top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where an anchor currently lives on screen. Empty array = not currently rendered. */
export interface AnchorRegion {
  /** Fixed layouts: which page these rects belong to. */
  page?: number;
  rects: Rect[];
  /** Reflow: live DOM range inside the section document (rects are already mapped to target space). */
  range?: Range;
}

/** Result of `anchorToRanges` when the stored anchor could be resolved (exactly or fuzzily). */
export interface ResolvedAnchor {
  regions: AnchorRegion[];
  /** `false` when only the fuzzy quote fallback matched; callers may want to refresh the stored anchor. */
  exact: boolean;
  /** Refreshed anchor to persist when `exact` is false. */
  updated?: Anchor;
}

// ---------------------------------------------------------------------------------------------
// Metadata, TOC, progress
// ---------------------------------------------------------------------------------------------

export interface BookMetadata {
  title: string;
  authors: string[];
  language?: string;
  publisher?: string;
  description?: string;
  /** ISO date string if known. */
  published?: string;
  series?: { name: string; index?: number };
  /** Read direction hint from the file (EPUB page-progression, comic manga flag). */
  direction?: ReadingDirection;
  /** Lazily produce the cover image (embedded cover, PDF page 1, first comic image). */
  cover?: () => Promise<Blob | null>;
}

export interface TocEntry {
  title: string;
  locator: Locator;
  children: TocEntry[];
}

/** Everything the shell needs to know after `open()`. */
export interface BookHandle {
  metadata: BookMetadata;
  toc: TocEntry[];
  layout: LayoutKind;
  /** False for scans without a text layer (search/selection/read-aloud unavailable until OCR). */
  hasText: boolean;
  /** Fixed layouts: number of pages. */
  pageCount?: number;
  /** Reflowable: approximate word count, for time-left estimates. */
  wordCount?: number;
  /** Optional printed page labels ("iv", "12") for fixed layouts, index = page. */
  pageLabels?: string[];
  /** What this engine instance can do; the UI enables/disables controls from this, not from the format. */
  capabilities: EngineCapabilities;
}

export interface EngineCapabilities {
  /** Text selection and anchors work. */
  selection: boolean;
  search: boolean;
  textStream: boolean;
  /** `thumbnail()` works. */
  thumbnails: boolean;
  /** Typography profile is honoured (reflowable only). */
  typography: boolean;
  /** Zoom / fit / rotation are honoured (fixed only). */
  zoom: boolean;
  /** Page Tint is honoured (fixed only). */
  pageTint: boolean;
  /** Double-page spreads are supported. */
  spreads: boolean;
  /** Paginated and scrolled flows both exist. */
  flows: boolean;
  /** `setOcrWords` works. */
  ocr: boolean;
}

export interface ChapterInfo {
  /** Index into the flattened TOC, or -1 when unknown. */
  index: number;
  title: string;
  /** 0..1 progress inside this chapter, if computable. */
  fraction?: number;
}

export interface Progress {
  /** 0..1 across the whole book. */
  fraction: number;
  chapter?: ChapterInfo;
  /** Fixed layouts: 0-based index of the first visible page and total. For spreads, the left page. */
  page?: { index: number; count: number; label?: string };
  /** Reflowable paginated: virtual page within the current chapter/book if the paginator can say. */
  location?: { index: number; count: number };
}

export interface RelocatedEvent {
  locator: Locator;
  progress: Progress;
  /** Why the position changed; the shell uses this to decide e.g. whether to push history. */
  reason: 'navigation' | 'page-turn' | 'scroll' | 'resize' | 'initial' | 'presentation';
}

// ---------------------------------------------------------------------------------------------
// Presentation (theme, typography, layout)
// ---------------------------------------------------------------------------------------------

/**
 * Theme colour tokens. Shared by the design system (src/lib/design) and the engines, which
 * can't see CSS variables inside iframes/canvases. All values are CSS colour strings.
 */
export interface Theme {
  id: string;
  name: string;
  /** Whether this is a dark scheme (drives Smart page tint, scrollbars, `color-scheme`). */
  dark: boolean;
  /** Page / app background. */
  bg: string;
  /** Raised surfaces (sidebars, popovers). */
  surface: string;
  /** Primary text. */
  text: string;
  /** Secondary text. */
  muted: string;
  accent: string;
  link: string;
  /** Text selection background. */
  selection: string;
  /** The four highlight colours, in key order 1..4 (yellow, green, blue, pink by default). */
  highlight: [string, string, string, string];
  shadow: string;
}

/** Font family choice: a bundled family id, a system family name, or 'publisher' to keep the book's own. */
export type FontChoice = 'publisher' | (string & {});

/** How strongly the reader's typography replaces the publisher's styles. */
export type PublisherOverride = 'off' | 'fonts' | 'all';

/** Text settings for reflowable books. Global default plus optional per-book override. */
export interface TypographyProfile {
  fontFamily: FontChoice;
  /** px */
  fontSize: number;
  /** 100..900 */
  fontWeight: number;
  /** Unitless multiplier. */
  lineHeight: number;
  /** em */
  letterSpacing: number;
  /** em */
  wordSpacing: number;
  /** Space between paragraphs, em. */
  paragraphSpacing: number;
  /** First-line indent, em. */
  textIndent: number;
  textAlign: 'start' | 'justify';
  hyphenation: boolean;
  /** Horizontal page margin, % of the viewport width. */
  marginX: number;
  /** Vertical page margin, % of the viewport height. */
  marginY: number;
  /** Maximum measure (line length) in `ch`; 0 = unlimited. */
  maxLineWidth: number;
  /** Paginated flow: 1, 2 columns, or choose from the viewport. */
  columns: 1 | 2 | 'auto';
  /** How much of the publisher's CSS is overridden with `!important` resets. */
  overridePublisher: PublisherOverride;
}

/** How a fixed-layout page is recoloured to match the Theme. */
export type PageTint = 'smart' | 'invert' | 'original';

export type ReadingDirection = 'ltr' | 'rtl';

/** `scrolled` is also what comics call webtoon mode (continuous vertical strip). */
export type Flow = 'paginated' | 'scrolled';

/** `auto` picks double when the viewport is wide enough (and, for comics, handles wide-page spreads). */
export type Spread = 'single' | 'double' | 'auto';

export type Fit = 'width' | 'height' | 'page' | 'actual' | 'custom';

export interface Presentation {
  theme: Theme;
  pageTint: PageTint;
  typography: TypographyProfile;
  flow: Flow;
  spread: Spread;
  /** Fixed layouts only: scale factor, 1 = 100%. Meaningful when `fit === 'custom'`; engines write the effective value back via 'presentationchange'. */
  zoom: number;
  fit: Fit;
  /** Fixed layouts only, clockwise degrees. */
  rotation: 0 | 90 | 180 | 270;
  direction: ReadingDirection;
}

// ---------------------------------------------------------------------------------------------
// Selection, decorations, search, text
// ---------------------------------------------------------------------------------------------

export interface EngineSelection {
  anchor: Anchor;
  text: string;
  /** Union of the selection's rects in render-target space, for positioning the floating menu. */
  rects: Rect[];
}

/** Named drawing layers; the engine draws them with theme colours and keeps them across re-layout. */
export type DecorationLayer = 'annotations' | 'search' | 'speech';

export type DecorationStyle =
  | { type: 'highlight'; color: 0 | 1 | 2 | 3 } // index into Theme.highlight
  | { type: 'underline'; color: 0 | 1 | 2 | 3 }
  | { type: 'note'; color: 0 | 1 | 2 | 3 } // highlight with a note marker
  | { type: 'bookmark' }
  | { type: 'search-hit'; current?: boolean }
  | { type: 'speech-word' }
  | { type: 'speech-sentence' };

export interface Decoration {
  /** Unique within its layer. */
  id: string;
  anchor: Anchor;
  style: DecorationStyle;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  signal?: AbortSignal;
}

export interface SearchHit {
  locator: Locator;
  excerpt: { before: string; match: string; after: string };
  /** Where this hit sits, for decoration and history; use as `Decoration.anchor`. */
  anchor: Anchor;
  /** Chapter / section title if known. */
  section?: string;
}

/** One sentence-ish unit of text, in reading order, for read-aloud and indexing. */
export interface TextChunk {
  text: string;
  /** Where the chunk starts. */
  locator: Locator;
  /** Where the chunk ends. */
  end: Locator;
  /**
   * Anchor for the sub-span `[start, end)` (UTF-16 offsets into `text`), used to highlight the
   * word currently spoken. May return null when the span cannot be located (e.g. page left DOM).
   */
  anchorFor(start: number, end: number): Promise<Anchor | null>;
}

export interface TextStreamOptions {
  signal?: AbortSignal;
  /** Preferred upper bound for a chunk's length in characters (default ~400). */
  maxChunkChars?: number;
}

/** A word found by OCR, in page space (PDF points, origin top-left). Fed in by the OCR pipeline. */
export interface OcrWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

export interface EngineEventMap {
  /** Position changed. Fired on initial render too (reason 'initial'). */
  relocated: RelocatedEvent;
  /** Selection changed; `null` when cleared. */
  selection: EngineSelection | null;
  /** Geometry changed (resize, zoom, re-layout, page render): re-query `anchorToRanges` if you hold regions. */
  layout: void;
  /** Effective presentation values the engine derived (e.g. zoom after fit-to-width). */
  presentationchange: Partial<Presentation>;
  /** User activated a link. Internal links are already followed by the engine; this is informational unless `external`. */
  link: { href: string; external: boolean; target?: Locator };
  /** Reflow footnote/endnote reference activated: show a popup with this content. */
  footnote: { html: string; rect: Rect; target?: Locator };
  /** A page/spread was clicked or tapped without selecting text (the shell uses it for tap zones and chrome toggling). */
  pointer: { x: number; y: number; zone: 'left' | 'right' | 'center'; button: number };
  /** Non-fatal problem (a page failed to render, a section could not be parsed). */
  warning: EngineError;
}

export type EngineEventHandler<K extends keyof EngineEventMap> = (event: EngineEventMap[K]) => void;

// ---------------------------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------------------------

export interface Engine {
  readonly kind: EngineKind;

  /**
   * Parse the document. No DOM work yet. Must be cheap enough to call for background indexing
   * (a hidden engine that only uses `textStream`/`search` is a supported use).
   */
  open(source: BookSource, options?: OpenOptions): Promise<BookHandle>;

  /**
   * Attach to `target` and draw at `locator` (default: start). `target` is an empty, sized
   * element owned by the shell; the engine fills it and observes its resizes. Calling `render`
   * again moves the engine to a new target (previous content is torn down).
   */
  render(target: HTMLElement, locator?: Locator): Promise<void>;

  /** Jump to a position. Resolves once it is on screen. */
  goTo(locator: Locator): Promise<void>;
  /** Jump to a fraction of the whole book (0..1). */
  goToFraction(fraction: number): Promise<void>;

  /** Turn the page (or spread). Resolves `false` at the end of the book. In scrolled flows: one viewport. */
  next(): Promise<boolean>;
  /** Resolves `false` at the start of the book. */
  prev(): Promise<boolean>;
  /** Scroll by `dy` CSS px in scrolled flows (arrow keys, auto-scroll, wheel emulation); paginated flows ignore it. */
  scrollBy(dy: number): void;

  /** Current position, or null before the first render. */
  getLocation(): RelocatedEvent | null;

  on<K extends keyof EngineEventMap>(type: K, handler: EngineEventHandler<K>): () => void;

  /** Merge new presentation values. Engines apply what applies to them and ignore the rest. */
  setPresentation(p: Partial<Presentation>): void;

  /** Full-text search through the book, streaming hits in reading order. Honour `signal`. */
  search(query: string, options?: SearchOptions): AsyncIterable<SearchHit>;

  /** Plain text between two locators (reading order). */
  getText(range: TextRange): Promise<string>;

  /** Convert a DOM selection (or the engine's current selection when omitted) to an Anchor. */
  selectionToAnchor(selection?: Selection | null): Promise<Anchor | null>;
  /** Current selection with its rects, or null. */
  getSelection(): EngineSelection | null;
  clearSelection(): void;

  /**
   * Resolve an anchor to on-screen regions. Tries the primary reference first, then fuzzy
   * quote matching near `anchor.locator`. Returns null when it cannot be placed at all
   * (orphaned annotation). An anchor that is valid but off-screen resolves with empty `regions`.
   */
  anchorToRanges(anchor: Anchor): Promise<ResolvedAnchor | null>;

  /** Replace everything drawn on a layer. The engine owns drawing and re-applies on re-layout. */
  setDecorations(layer: DecorationLayer, items: Decoration[]): void;

  /** Stream text from `from` (default: current position) to the end of the book. */
  textStream(from?: Locator, options?: TextStreamOptions): AsyncIterable<TextChunk>;

  /** Fixed layouts: render a page thumbnail no wider than `maxWidth` px. Null if unsupported. */
  thumbnail?(page: number, maxWidth: number): Promise<Blob | ImageBitmap | null>;

  /** Fixed layouts: provide OCR words so scans get a synthetic text layer. */
  setOcrWords?(page: number, words: OcrWord[]): void;

  /** Release workers, observers, DOM, object URLs. The instance is unusable afterwards. */
  dispose(): void;
}

/** Engines are created through a factory so the shell can lazy-load them. */
export type EngineFactory = () => Promise<Engine>;

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export type EngineErrorCode =
  | 'unsupported-format'
  | 'corrupt'
  | 'password-required'
  | 'password-cancelled'
  | 'aborted'
  | 'not-rendered'
  | 'network'
  | 'unknown';

export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? code, options);
    this.name = 'EngineError';
  }
}
