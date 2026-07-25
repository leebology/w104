import { useState } from "react";
import { getProfile, saveProfile } from "../net/identity";

export const AVATARS = [
  "🐙", "🦊", "🐸", "🐼", "🦉", "🐝", "🦀", "🐬",
  "🌵", "🍄", "🌶️", "🍋", "⚡", "🌙", "🔥", "💎",
  "🎩", "👾", "🤖", "👻", "🦖", "🐌", "🦩", "🧊",
] as const;

type Props = {
  onCreate: () => void;
  onJoin: (code: string, name: string, emoji: string) => void;
};

export function Landing({ onCreate, onJoin }: Props) {
  const [saved] = useState(getProfile);
  const [mode, setMode] = useState<"pick" | "join">("pick");
  const [code, setCode] = useState("");
  const [name, setName] = useState(saved.name);
  const [emoji, setEmoji] = useState(saved.emoji || AVATARS[0]);

  if (mode === "pick") {
    return (
      <main>
        <h1>w104</h1>
        <p className="tagline">Making lists is more fun with friends.</p>
        <button type="button" onClick={() => setMode("join")}>Join lobby</button>
        <button type="button" onClick={onCreate}>Create new lobby</button>
        <p className="hint">Creating a lobby makes this device the shared screen.</p>
      </main>
    );
  }

  const ready = code.trim().length > 0 && name.trim().length > 0;

  return (
    <main>
      <h1>Join</h1>
      <label>
        Room code
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect="off"
          maxLength={8}
          placeholder="PLUM"
        />
      </label>
      <label>
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
      </label>

      <div className="avatars">
        {AVATARS.map((a) => (
          <button
            key={a}
            type="button"
            className={a === emoji ? "avatar selected" : "avatar"}
            aria-pressed={a === emoji}
            onClick={() => setEmoji(a)}
          >
            {a}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={!ready}
        onClick={() => {
          saveProfile(name.trim(), emoji);
          onJoin(code.trim(), name.trim(), emoji);
        }}
      >
        Join
      </button>
      <button type="button" onClick={() => setMode("pick")}>Back</button>
    </main>
  );
}
