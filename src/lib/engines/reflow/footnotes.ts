/**
 * Footnote detection and extraction (after foliate-js/footnotes.js, minus its second <foliate-view>),
 * and a strict sanitiser: the shell gets inert HTML (text + a few inline/block tags, no attributes).
 */
const EPUB_NS = 'http://www.idpf.org/2007/ops';

const types = (el: Element | null | undefined) => new Set(el?.getAttributeNS?.(EPUB_NS, 'type')?.split(/\s+/) ?? []);
const roles = (el: Element | null | undefined) => new Set(el?.getAttribute?.('role')?.split(/\s+/) ?? []);

const isSuper = (el: Element | null): boolean => {
  if (!el) return false;
  if (el.matches('sup')) return true;
  const va = el.ownerDocument.defaultView?.getComputedStyle(el).verticalAlign ?? '';
  return va === 'super' || va === 'top' || va === 'text-top' || /^\d/.test(va);
};

const REF_TYPES = ['biblioref', 'glossref', 'noteref'];
const REF_ROLES = ['doc-biblioref', 'doc-glossref', 'doc-noteref'];

/** `yes`: declared note reference. `maybe()`: looks like a superscript note marker. */
export function noteRefKind(a: Element): { yes: boolean; maybe: () => boolean } {
  const t = types(a);
  const r = roles(a);
  return {
    yes: REF_ROLES.some((x) => r.has(x)) || REF_TYPES.some((x) => t.has(x)),
    maybe: () =>
      !t.has('backlink') &&
      !r.has('doc-backlink') &&
      (isSuper(a) || (a.children.length === 1 && isSuper(a.children[0]!)) || isSuper(a.parentElement)),
  };
}

export function referencedType(el: Element | null): string | null {
  const t = types(el);
  const r = roles(el);
  return r.has('doc-biblioentry') || t.has('biblioentry') ? 'biblioentry'
    : r.has('definition') || t.has('glossdef') ? 'definition'
    : r.has('doc-endnote') || t.has('endnote') || t.has('rearnote') ? 'endnote'
    : r.has('doc-footnote') || t.has('footnote') ? 'footnote'
    : r.has('note') || t.has('note') ? 'note'
    : null;
}

const INLINE = 'a, span, sup, sub, em, strong, i, b, small, big';

/** The element holding the note's content, given whatever the link target resolved to. */
export function noteElement(target: Element | Range | null | undefined): Element | null {
  if (!target) return null;
  let el: Element | null =
    'startContainer' in target
      ? (target.startContainer.nodeType === 1 ? (target.startContainer as Element) : target.startContainer.parentElement)
      : target;
  if (!el) return null;
  if (el.matches('li, aside')) return el;
  const li = el.closest('li, aside');
  if (li) return li;
  while (el.matches(INLINE)) {
    const parent: Element | null = el.parentElement;
    if (!parent) break;
    el = parent;
  }
  const body = el.ownerDocument.body;
  if (el === body) {
    const sib = (target as Element).nextElementSibling;
    return sib && !sib.matches(INLINE) ? sib : null;
  }
  return el;
}

const ALLOWED = new Set([
  'p', 'div', 'span', 'em', 'i', 'strong', 'b', 'sup', 'sub', 'small', 'br', 'ul', 'ol', 'li', 'blockquote', 'cite',
  'q', 'code', 'abbr', 'dfn', 'mark', 'u', 's', 'section', 'aside', 'figure', 'figcaption',
]);
const AS_PARAGRAPH = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dd', 'dt', 'td', 'th', 'tr', 'header']);
const DROP = new Set(['script', 'style', 'link', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'img', 'svg', 'math', 'video', 'audio', 'canvas', 'template', 'noscript']);

const isBacklink = (a: Element) => {
  const t = types(a);
  const r = roles(a);
  return t.has('backlink') || r.has('doc-backlink') || /^[\s↩↥↑⏎↵^]+$/.test(a.textContent ?? '');
};

/** Strict allow-list sanitiser. Output has no attributes, links or media. */
export function sanitizeNote(el: Element): string {
  const doc = el.ownerDocument.implementation.createHTMLDocument('');
  const out = doc.createElement('div');
  const walk = (src: Node, dst: Node) => {
    for (const n of Array.from(src.childNodes)) {
      if (n.nodeType === 3) {
        dst.appendChild(doc.createTextNode(n.nodeValue ?? ''));
        continue;
      }
      if (n.nodeType !== 1) continue;
      const e = n as Element;
      const name = e.localName.toLowerCase();
      if (DROP.has(name)) continue;
      if (name === 'a') {
        if (isBacklink(e)) continue;
        walk(e, dst); // keep the text, drop the link
        continue;
      }
      if (ALLOWED.has(name)) {
        const copy = doc.createElement(name === 'section' || name === 'aside' || name === 'figure' ? 'div' : name);
        walk(e, copy);
        dst.appendChild(copy);
      } else if (AS_PARAGRAPH.has(name)) {
        const p = doc.createElement('p');
        walk(e, p);
        dst.appendChild(p);
      } else walk(e, dst);
    }
  };
  walk(el, out);
  // A bare text note gets a paragraph so the popup can style it.
  const html = out.innerHTML.trim();
  return html.startsWith('<') ? html : `<p>${html}</p>`;
}
