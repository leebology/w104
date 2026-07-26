import { useEffect, useRef, useState } from "react";
import { Wordmark } from "../components/Wordmark";

const CODE_LEN = 4;

/** Four single-letter boxes, 2FA-style, instead of one free-text field. */
function RoomCodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const chars = Array.from({ length: CODE_LEN }, (_, i) => value[i] ?? "");

  const setChar = (i: number, ch: string) => {
    const next = chars.slice();
    next[i] = ch;
    onChange(next.join(""));
  };

  return (
    <div className="code-boxes">
      {chars.map((ch, i) => (
        <input
          key={i}
          ref={(el) => { boxes.current[i] = el; }}
          value={ch}
          onChange={(e) => {
            const raw = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
            if (raw.length > 1) {
              // Handles pasting the whole code into one box.
              const letters = raw.slice(0, CODE_LEN - i).split("");
              const next = chars.slice();
              letters.forEach((c, j) => { next[i + j] = c; });
              onChange(next.join(""));
              boxes.current[Math.min(i + letters.length, CODE_LEN - 1)]?.focus();
              return;
            }
            setChar(i, raw);
            if (raw && i < CODE_LEN - 1) boxes.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !chars[i] && i > 0) {
              boxes.current[i - 1]?.focus();
            } else if (e.key === "Enter" && i < CODE_LEN - 1) {
              e.preventDefault();
              boxes.current[i + 1]?.focus();
            }
          }}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          maxLength={1}
          // A typed box lifts off the page in gold; an empty one stays sunken.
          className={ch ? "code-box code-box--filled" : "code-box"}
          aria-label={`Room code letter ${i + 1}`}
        />
      ))}
    </div>
  );
}

type Props = {
  onCreate: () => void;
  onJoin: (code: string) => void;
  /** A failed join attempt (bad code, game already running) — shown inline,
   * since the code boxes are right here on the same page. */
  joinError?: string | null;
};

export function Landing({ onCreate, onJoin, joinError }: Props) {
  const [code, setCode] = useState("");
  // Guards against re-firing for the same completed code — e.g. if this
  // component re-renders for an unrelated reason while the code is still
  // sitting at 4 characters. Editing any box changes `code`, which lifts
  // the guard for the next attempt.
  const submitted = useRef<string | null>(null);

  useEffect(() => {
    if (code.length !== CODE_LEN) return;
    if (submitted.current === code) return;
    submitted.current = code;
    onJoin(code);
  }, [code, onJoin]);

  return (
    <main className="screen screen--mobile screen--locked landing">
      <Wordmark />

      {/* The code boxes are themselves the join button — filling the fourth
          one submits, so there is no separate call to action here. */}
      <section className="card code-card">
        <h1 className="code-card__label">Enter room code</h1>
        <RoomCodeInput value={code} onChange={setCode} />
        {joinError && <p className="code-card__error">{joinError}</p>}
      </section>

      <div className="divider"><span>OR</span></div>

      <section className="card create-card">
        <p className="create-card__copy">
          No room yet? This device becomes the shared screen and doesn’t play.
        </p>
        <button type="button" className="btn btn--block" onClick={onCreate}>
          Create a room
        </button>
      </section>

      <span className="version">v{__APP_VERSION__}</span>
    </main>
  );
}
