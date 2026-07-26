/**
 * Order is append-only: a player's choice is stored as the emoji itself, not
 * an index, but the first row a returning player sees should still be the one
 * they remember. New arrivals go on the end.
 */
export const AVATARS = [
  "🐙", "🦊", "🐸", "🐼", "🦉", "🐝", "🦀", "🐬",
  "🌵", "🍄", "🌶️", "🍋", "⚡", "🌙", "🔥", "💎",
  "🎩", "👾", "🤖", "👻", "🦖", "🐌", "🦩", "🧊",
  "🦄", "🐢", "🦔", "🐧", "🦇", "🐳", "🦥", "🐊",
  "🌻", "🍉", "🥑", "🍕", "🌈", "⭐", "❄️", "🍀",
  "👑", "🎸", "🚀", "🛸", "🎲", "🧃", "🪩", "🥁",
] as const;

type Props = {
  value: string;
  onChange: (emoji: string) => void;
};

export function AvatarPicker({ value, onChange }: Props) {
  return (
    <div className="avatars">
      {AVATARS.map((a) => (
        <button
          key={a}
          type="button"
          className={a === value ? "avatar avatar--selected" : "avatar"}
          aria-pressed={a === value}
          aria-label={`Avatar ${a}`}
          onClick={() => onChange(a)}
        >
          {a}
        </button>
      ))}
    </div>
  );
}
