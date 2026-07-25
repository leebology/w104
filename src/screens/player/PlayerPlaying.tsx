import { useEffect, useRef, useState } from "react";
import { useRemaining } from "../../net/clock";
import { roomStore } from "../../net/room";
import type { LocalEntry } from "../../net/room";

type Props = {
  category: string;
  endsAt: number;
  offset: number;
  entries: LocalEntry[];
  rejected: string | null;
};

export function PlayerPlaying({ category, endsAt, offset, entries, rejected }: Props) {
  const [text, setText] = useState("");
  const remaining = useRemaining(endsAt, offset);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);

  return (
    <main className="playing">
      <header>
        <span className="prompt">NAME A: <strong>{category}</strong></span>
        <span className="timer">{remaining}</span>
      </header>

      <ol className="entries">
        {entries.map((entry, i) => (
          <li key={entry.seq ?? `${entry.at}-${i}`}>{entry.text}</li>
        ))}
      </ol>
      <div ref={bottom} />

      {rejected && <p className="reject">{rejected}</p>}

      <form
        className="entry-form"
        onSubmit={(e) => {
          // preventDefault keeps focus on the input, so the phone keyboard
          // stays up between words.
          e.preventDefault();
          roomStore.submit(text);
          setText("");
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          autoComplete="off"
          autoCorrect="on"
          enterKeyHint="done"
          maxLength={64}
          aria-label={`Name a ${category}`}
        />
        <button type="submit">Add</button>
      </form>
    </main>
  );
}
