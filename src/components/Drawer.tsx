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
          <button
            type="button"
            className="drawer__close"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="drawer__body">{children}</div>
      </aside>
    </div>
  );
}
