import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";
import type { IframeWindow } from "../player/lib/playbackTypes";
import { furthestClipEndFromDocument } from "../player/lib/timelineElementHelpers";
import { resolveRootLength } from "../utils/timelineAssetDrop";

function documentRoot(doc: Document | null | undefined): Element | null {
  const nodes = Array.from(doc?.querySelectorAll("[data-composition-id]") ?? []);
  return (
    nodes.find((node) => !node.parentElement?.closest("[data-composition-id]")) ?? nodes[0] ?? null
  );
}

export function patchDocumentRootDuration(
  doc: Document | null | undefined,
  contentEnd: number,
): boolean {
  if (!doc || !Number.isFinite(contentEnd) || contentEnd <= 0) return false;
  const root = documentRoot(doc);
  if (!root) return false;
  root.setAttribute("data-duration", formatTimelineAttributeNumber(contentEnd));
  return true;
}

export function readLiveAnimationEnd(iframe: HTMLIFrameElement | null): number {
  try {
    const win = iframe?.contentWindow as IframeWindow | null | undefined;
    const end = win?.__hf?.animationEnd?.();
    return typeof end === "number" && Number.isFinite(end) && end > 0 ? end : 0;
  } catch {
    return 0;
  }
}

export function isPreviewedFile(path: string, activeCompPath: string | null): boolean {
  return path === (activeCompPath || "index.html");
}

export function animationEndFor(
  iframe: HTMLIFrameElement | null,
  path: string,
  activeCompPath: string | null,
): number {
  return isPreviewedFile(path, activeCompPath) ? readLiveAnimationEnd(iframe) : 0;
}

export function captureLiveLength(iframe: HTMLIFrameElement | null): () => number {
  const raw = documentRoot(iframe?.contentDocument)?.getAttribute("data-duration");
  const rootLength = raw == null ? null : Number.parseFloat(raw);
  const contentEnd = Math.max(liveClipsEnd(iframe), readLiveAnimationEnd(iframe));
  return () =>
    resolveRootLength(rootLength, contentEnd, liveClipsEnd(iframe), readLiveAnimationEnd(iframe));
}

function liveClipsEnd(iframe: HTMLIFrameElement | null): number {
  return furthestClipEndFromDocument(iframe?.contentDocument);
}
