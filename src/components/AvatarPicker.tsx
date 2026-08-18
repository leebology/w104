import { AVATARS } from "../../shared/avatars";

/**
 * The list moved to `shared/avatars.ts` when no-two-alike became a rule the
 * server enforces. Re-exported here so every import site that had it from this
 * module keeps working.
 */
export { AVATARS };

type Props = {
  value: string;
  /**
   * Worn by somebody else in this room. Rendered faded and unpressable — the
   * server refuses these anyway (`setProfile` in `shared/reduce.ts`), so
   * without this the tap would simply do nothing and look broken.
   *
   * Never contains `value`: the caller passes `takenAvatars(players, me)`, so
   * your own face is not something you are locked out of.
   */
  taken: ReadonlySet<string>;
  onChange: (emoji: string) => void;
};

export function AvatarPicker({ value, taken, onChange }: Props) {
  return (
    <div className="avatars">
      {AVATARS.map((a) => {
        const mine = a === value;
        const gone = !mine && taken.has(a);
        const classes = ["avatar"];
        if (mine) classes.push("avatar--selected");
        if (gone) classes.push("avatar--taken");

        return (
          <button
            key={a}
            type="button"
            className={classes.join(" ")}
            aria-pressed={mine}
            // `disabled` rather than a click that is ignored: it takes the
            // button out of the tab order too, so nobody arrives at one by
            // keyboard and finds it inert with no explanation.
            disabled={gone}
            aria-label={gone ? `Avatar ${a}, taken` : `Avatar ${a}`}
            onClick={() => onChange(a)}
          >
            {a}
          </button>
        );
      })}
    </div>
  );
}
