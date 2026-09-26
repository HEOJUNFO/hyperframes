import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";

export function patchDocumentRootDuration(
  doc: Document | null | undefined,
  contentEnd: number,
): boolean {
  if (!doc || !Number.isFinite(contentEnd) || contentEnd <= 0) return false;
  const nodes = Array.from(doc.querySelectorAll("[data-composition-id]"));
  const root =
    nodes.find((node) => !node.parentElement?.closest("[data-composition-id]")) ?? nodes[0] ?? null;
  if (!root) return false;
  root.setAttribute("data-duration", formatTimelineAttributeNumber(contentEnd));
  return true;
}

/** Where the live preview's animations end, in seconds; 0 when the runtime cannot say. */
export function readLiveAnimationEnd(iframe: HTMLIFrameElement | null): number {
  try {
    const win = iframe?.contentWindow as
      | (Window & { __hf?: { animationEnd?: () => number | null } })
      | null
      | undefined;
    const end = win?.__hf?.animationEnd?.();
    return typeof end === "number" && Number.isFinite(end) && end > 0 ? end : 0;
  } catch {
    // Cross-origin or mid-navigation.
    return 0;
  }
}
