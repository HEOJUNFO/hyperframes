import { COLOR_GRADING_SOURCE_HIDDEN_ATTR } from "../colorGrading";

type Rect = { left: number; right: number; top: number; bottom: number };

const TRANSPARENT = /^(|transparent|rgba\(.*,\s*0\)|.*\/\s*0%?\s*\))$/;
const PICTURES = new Set(["IMG", "VIDEO", "IFRAME", "EMBED", "OBJECT", "CANVAS"]);
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_BOXES = new Set(["svg", "g", "foreignObject"]);
const SIDES = ["Top", "Right", "Bottom", "Left"] as const;
const EVERYWHERE: Rect = { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };

const paints = (style: CSSStyleDeclaration): boolean =>
  (Boolean(style.backgroundImage) && style.backgroundImage !== "none") ||
  !TRANSPARENT.test(style.backgroundColor);

// Glyphs paint with the text fill colour (`color` unless set apart) or a text stroke.
const glyphsPaint = (style: CSSStyleDeclaration): boolean => {
  const fill = style.getPropertyValue("-webkit-text-fill-color") || style.color;
  const stroke = Number.parseFloat(style.getPropertyValue("-webkit-text-stroke-width")) || 0;
  const strokeColor = style.getPropertyValue("-webkit-text-stroke-color") || style.color;
  return !TRANSPARENT.test(fill) || (stroke > 0 && !TRANSPARENT.test(strokeColor));
};

const borderWidths = (style: CSSStyleDeclaration): number[] =>
  SIDES.map((side) =>
    style[`border${side}Style`] !== "none" && !TRANSPARENT.test(style[`border${side}Color`])
      ? Number.parseFloat(style[`border${side}Width`]) || 0
      : 0,
  );

const height = (r: Rect) => r.bottom - r.top;
const holds = (r: Rect, x: number, y: number) =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
const unite = (a: Rect, b: Rect): Rect => ({
  left: Math.min(a.left, b.left),
  right: Math.max(a.right, b.right),
  top: Math.min(a.top, b.top),
  bottom: Math.max(a.bottom, b.bottom),
});

/** Glyphs side by side on one line, no further apart than two line heights, join into one line box. */
function lineBoxes(glyphs: readonly Rect[]): Rect[] {
  const lines: Rect[] = [];
  for (const g of [...glyphs].sort((a, b) => a.left - b.left)) {
    const i = lines.findIndex(
      (line) =>
        g.top < line.bottom &&
        g.bottom > line.top &&
        g.left - line.right <= 2 * Math.max(height(line), height(g)),
    );
    if (i < 0) lines.push(g);
    else lines[i] = unite(lines[i]!, g);
  }
  return lines;
}

/** The leading between two close lines of one block counts as the block's text too. */
function leadings(lines: readonly Rect[]): Rect[] {
  const sorted = [...lines].sort((a, b) => a.top - b.top);
  return sorted.flatMap((upper, i) =>
    sorted.slice(i + 1).flatMap((lower) => {
      const beside = lower.left < upper.right && lower.right > upper.left;
      const close = lower.top - upper.bottom <= 2 * Math.min(height(upper), height(lower));
      return beside && close && lower.top > upper.bottom ? [unite(upper, lower)] : [];
    }),
  );
}

/**
 * Whether an element draws pixels of its own at (x, y). One probe serves one pick, so every
 * candidate shares its text measurements.
 */
export function createDrawnProbe(doc: Document, x: number, y: number): (el: Element) => boolean {
  const view = doc.defaultView;
  const layout = typeof doc.createRange().getClientRects === "function";
  const range = doc.createRange();
  const glyphsIn = new Map<Element, Rect[]>();
  const closedBox = new Map<Element, boolean>();
  const shownTextNode = new Map<Node, boolean>();

  // Hidden, its own out-of-flow box, or a box too far from the pointer's row for its text to reach it.
  const closed = (el: Element): boolean => {
    let known = closedBox.get(el);
    if (known === undefined) {
      const s = view!.getComputedStyle(el);
      const faded =
        Number.parseFloat(s.opacity) <= 0.01 && !el.hasAttribute(COLOR_GRADING_SOURCE_HIDDEN_ATTR);
      known = s.display === "none" || faded || s.position === "absolute" || s.position === "fixed";
      if (!known && layout) {
        const r = el.getBoundingClientRect();
        const byFont = 3 * (Number.parseFloat(s.fontSize) || 16);
        // A box may hold lines bigger than its own font, up to about ten times it.
        const reach = Math.max(byFont, Math.min(2 * r.height, (20 * byFont) / 3));
        known = (r.width > 0 || r.height > 0) && (y < r.top - reach || y > r.bottom + reach);
      }
      closedBox.set(el, known);
    }
    return known;
  };
  const shownText = (node: Node): boolean => {
    let known = shownTextNode.get(node);
    if (known === undefined) {
      const parent = node.parentElement;
      const s = parent && node.nodeValue?.trim() ? view!.getComputedStyle(parent) : null;
      known = Boolean(s) && s!.visibility !== "hidden" && glyphsPaint(s!);
      shownTextNode.set(node, known);
    }
    return known;
  };
  // Only glyphs near the pointer's row can make a line or a leading that covers it.
  const glyphsNear = (node: Node): Rect[] => {
    // No layout to ask (a DOM without rendering): shown text counts wherever the pointer is.
    if (!layout) return [EVERYWHERE];
    const glyphs: Rect[] = [];
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      const h = r.bottom - r.top;
      if (r.width > 0 && h > 0 && y >= r.top - 2 * h && y <= r.bottom + 2 * h) glyphs.push(r);
    }
    return glyphs;
  };
  // The glyphs of the text an element lays out itself, collected once per pick for every candidate.
  const glyphsUnder = (el: Element): Rect[] => {
    let glyphs = glyphsIn.get(el);
    if (glyphs) return glyphs;
    glyphs = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        if (shownText(child)) glyphs.push(...glyphsNear(child));
      } else if (child.nodeType === 1 && child.hasChildNodes() && !closed(child as Element)) {
        glyphs.push(...glyphsUnder(child as Element));
      }
    }
    glyphsIn.set(el, glyphs);
    return glyphs;
  };

  function textAt(el: Element): boolean {
    const lines = lineBoxes(glyphsUnder(el));
    return (
      lines.some((line) => holds(line, x, y)) || leadings(lines).some((gap) => holds(gap, x, y))
    );
  }

  function pseudoDraws(el: Element, pseudo: string): boolean {
    const s = view!.getComputedStyle(el, pseudo);
    if (!s.content || s.content === "none" || s.content === "normal" || s.display === "none")
      return false;
    return s.content !== '""' || paints(s) || borderWidths(s).some((w) => w > 0);
  }

  // A border draws on its band, not across the box it frames; an outer shadow draws outside the box.
  function decoratedAt(el: Element, s: CSSStyleDeclaration): boolean {
    if (/inset/.test(s.boxShadow)) return true;
    const [top, right, bottom, left] = borderWidths(s) as [number, number, number, number];
    if (top || right || bottom || left) {
      const r = el.getBoundingClientRect();
      const { offsetWidth, offsetHeight } = el as HTMLElement;
      const kx = offsetWidth > 0 ? r.width / offsetWidth : 1;
      const ky = offsetHeight > 0 ? r.height / offsetHeight : 1;
      const inner = {
        left: r.left + left * kx,
        right: r.right - right * kx,
        top: r.top + top * ky,
        bottom: r.bottom - bottom * ky,
      };
      if (!holds(inner, x, y)) return true;
    }
    return pseudoDraws(el, "::before") || pseudoDraws(el, "::after");
  }

  return (el) => {
    if (PICTURES.has(el.tagName)) return true;
    const box = el.namespaceURI !== SVG_NS || SVG_BOXES.has(el.localName);
    if (!box) return true;
    if (!view) return true;
    const s = view.getComputedStyle(el);
    return paints(s) || decoratedAt(el, s) || (el.namespaceURI !== SVG_NS && textAt(el));
  };
}
