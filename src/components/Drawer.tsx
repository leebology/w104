import { useEffect } from "react";
import type { ReactNode } from "react";

type Props = {
  side: "left" | "right";
  open: boolean;
  /** Rendered as the panel heading and as its accessible name. */
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * An edge panel over the host lobby. Overlay rather than push: the lobby
 * underneath keeps its exact sizing, and the room code banner — which is
 * negative-margined to full bleed — never has to reflow behind it.
 *
 * An inset rounded card rather than a full-height slab, so it reads as one
 * more object on the pink field rather than as a second screen sliding over
 * the first. The only way out is the gold arrow straddling its inner edge, or
 * the scrim: there is no close box, because a `×` in the corner of a panel
 * that already has a handle is two controls for one job.
 *
 * Unmounts when closed rather than hiding: nothing inside a drawer holds state
 * worth preserving across a close, and the host screen owns the viewport
 * exactly, so a hidden-but-mounted panel is a layout risk for nothing.
 */
export function Drawer({ side, open, title, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={`drawer drawer--${side}`}>
      <button
        type="button"
        className="drawer__scrim"
        aria-label={`Close ${title}`}
        onClick={onClose}
      />
      <aside className="drawer__panel" role="dialog" aria-label={title}>
        <header className="drawer__head">
          <h2 className="drawer__title">{title}</h2>
        </header>
        <div className="drawer__body">{children}</div>
      </aside>
      {/* Points back at the edge it came from, so the arrow reads as the
          direction the panel is about to travel rather than as a chevron
          into more content. */}
      <button
        type="button"
        className="drawer__handle"
        aria-label={`Collapse ${title}`}
        onClick={onClose}
      >
        {side === "left" ? "‹" : "›"}
      </button>
    </div>
  );
}
