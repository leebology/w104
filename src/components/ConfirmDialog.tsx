import { useEffect } from "react";

type Props = {
  title: string;
  body: string;
  /** The wording on the button that goes through with it. */
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A destructive confirmation over a host screen. The pink cap strip across
 * the top is the whole signal: `--pink` is the field colour everywhere else
 * in the app and appears inside a cream card nowhere but here, so a dialog
 * wearing it reads as a different kind of question before a word is read.
 *
 * Escape and a tap on the scrim both cancel — either way it is the safe exit,
 * never the confirm.
 */
export function ConfirmDialog({
  title, body, confirmLabel, cancelLabel, onConfirm, onCancel,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="confirm">
      <div className="confirm__scrim" onClick={onCancel} />
      <div className="confirm__box" role="alertdialog" aria-label={title}>
        <div className="confirm__cap" />
        <div className="confirm__copy">
          <h2 className="confirm__title">{title}</h2>
          <p className="confirm__body">{body}</p>
        </div>
        <div className="confirm__actions">
          <button
            type="button"
            className="btn btn--secondary confirm__cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button type="button" className="btn" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
