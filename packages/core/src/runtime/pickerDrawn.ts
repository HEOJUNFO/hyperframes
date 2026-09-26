import { COLOR_GRADING_SOURCE_HIDDEN_ATTR } from "../colorGrading";

type Rect = { left: number; right: number; top: number; bottom: number };

const TRANSPARENT = /^(|transparent|rgba\(.*,\s*0\))$/;
const PICTURES = new Set(["IMG", "VIDEO", "IFRAME", "EMBED", "OBJECT", "CANVAS"]);
const SVG_NS = "http://www.w3.org/2000/svg";
const SIDES = ["Top", "Right", "Bottom", "Left"] as const;

function paints(style: CSSStyleDeclaration): boolean {
  const image = style.backgroundImage;
  if (image && image !== "none") return true;
  return !TRANSPARENT.test(style.backgroundColor);
}

/** A border, a shadow, or ::before/::after content (icon fonts, rings). */
function decorated(el: Element, style: CSSStyleDeclaration): boolean {
  if (style.boxShadow && style.boxShadow !== "none") return true;
  const bordered = SIDES.some(
    (side) =>
      Number.parseFloat(style[`border${side}Width`]) > 0 &&
      style[`border${side}Style`] !== "none" &&
      !TRANSPARENT.test(style[`border${side}Color`]),
  );
  if (bordered) return true;
  const view = el.ownerDocument.defaultView;
  return ["::before", "::after"].some((pseudo) => {
    const content = view?.getComputedStyle(el, pseudo).content;
    return Boolean(content) && content !== "none" && content !== "normal";
  });
}

/** Hidden itself (a child may turn visibility back on), or undisplayed or faded out anywhere up to `root`. */
function unseenText(node: Node, root: Element): boolean {
  const view = root.ownerDocument.defaultView;
  let el = node.parentElement;
  if (el && view?.getComputedStyle(el).visibility === "hidden") return true;
  for (; el && view; el = el.parentElement) {
    const style = view.getComputedStyle(el);
    const faded =
      Number.parseFloat(style.opacity) <= 0.01 &&
      !el.hasAttribute(COLOR_GRADING_SOURCE_HIDDEN_ATTR);
    if (style.display === "none" || faded) return true;
    if (el === root) return false;
  }
  return false;
}

/** Glyph boxes of the shown text anywhere inside `el`; null without layout to ask. */
function glyphBoxes(el: Element): Rect[] | null {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = el.ownerDocument.createRange();
  const boxes: Rect[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue?.trim() || unseenText(node, el)) continue;
    range.selectNodeContents(node);
    const rects = range.getClientRects?.();
    if (!rects?.length) return null;
    boxes.push(...[...rects].filter((r) => r.width > 0 && r.height > 0));
  }
  return boxes;
}

const unite = (a: Rect, b: Rect): Rect => ({
  left: Math.min(a.left, b.left),
  right: Math.max(a.right, b.right),
  top: Math.min(a.top, b.top),
  bottom: Math.max(a.bottom, b.bottom),
});
const height = (r: Rect) => r.bottom - r.top;
const holds = (r: Rect, x: number, y: number) =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

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

function textAt(el: Element, x: number, y: number): boolean {
  const glyphs = glyphBoxes(el);
  if (!glyphs) return true;
  const lines = lineBoxes(glyphs);
  return lines.some((line) => holds(line, x, y)) || leadings(lines).some((gap) => holds(gap, x, y));
}

/** Pixels of its own at (x, y): a fill, a picture, a shape, a border, shadow or pseudo content, or its text there. */
export function drawsAt(el: Element, x: number, y: number): boolean {
  if (PICTURES.has(el.tagName)) return true;
  if (el.namespaceURI === SVG_NS && el.tagName.toLowerCase() !== "g") return true;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!style) return true;
  return paints(style) || decorated(el, style) || textAt(el, x, y);
}
