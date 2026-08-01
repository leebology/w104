import { useEffect, useRef, useState } from "react";
import type { TouchEvent } from "react";
import { roomStore } from "../../net/room";
import { quotaOfRoom, writersOf } from "../../../shared/customCategories";
import type { RoomState } from "../../../shared/state";
import type { PlayerId } from "../../../shared/state";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  drafts: string[];
  offset: number;
};

export function PlayerCreating({ room, playerId, drafts }: Props) {
  const me = room.players.find((p) => p.id === playerId);
  const quota = quotaOfRoom(room);

  // In-flight text for the current slot
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // The ready screen below reads from here rather than from the `drafts`
  // prop directly. `drafts` is server state, one `yourDrafts` round-trip
  // behind — and `ready` (also server state) can flip true and re-render
  // the moment the *other* message, `state`, arrives, which can beat
  // `yourDrafts` to the socket. Mirroring every local commit here means the
  // ready view is always correct the instant it appears; `drafts` only has
  // to seed it for a player who reconnects mid-phase.
  const [myDrafts, setMyDrafts] = useState<string[]>(drafts);
  useEffect(() => {
    setMyDrafts(drafts);
  }, [drafts]);

  // The Durable Object is the sole authority: `writeSlot` in shared/reduce.ts
  // sets `ready` once every slot is committed, so the client reads it back
  // rather than re-deriving it from `drafts`. `localUnready` is the same
  // optimism `myDrafts` uses, for the same reason: tapping a ready card to
  // rewrite it sends `clearDraft`, but nothing switches this screen off the
  // ready view until the server round-trips `ready: false` back — by which
  // point the tap's user gesture has expired, so the write view's focus()
  // below gets silently ignored on iOS. Flipping this synchronously with the
  // tap keeps the whole thing inside one gesture. Cleared once the server
  // actually reports not-ready, so a later real ready-up is not masked by it.
  const [localUnready, setLocalUnready] = useState(false);
  const ready = me?.ready === true && !localUnready;
  useEffect(() => {
    if (me?.ready !== true) setLocalUnready(false);
  }, [me?.ready]);

  // Alternates on every commit-driven advance so the slide animation
  // restarts — reapplying an identical class in the same tick does not
  // retrigger a CSS animation.
  const [advanceParity, setAdvanceParity] = useState<"a" | "b" | null>(null);

  // handleChipTap debounces its moveCursor send by ~150ms so mashing the
  // pager sends one message, not one per tap.
  const moveCursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (moveCursorTimer.current) clearTimeout(moveCursorTimer.current);
    };
  }, []);

  // Opens the keyboard the moment the writing phase reaches this phone — the
  // same unconditional `.focus()` call `PlayerView` makes when `playing`
  // starts, and for the same reason: the transition has no user gesture
  // behind it, so iOS may decline, but every other platform still gets it.
  // `preventScroll` matches `Landing`'s `focusBox`: a plain `focus()` asks
  // the browser to scroll the field into view, and on a locked screen that
  // is already fully on screen there is nothing for that scroll to reveal —
  // it only drags the page under the player's thumb while the keyboard is up.
  useEffect(() => {
    if (!ready) inputRef.current?.focus({ preventScroll: true });
  }, [ready]);

  const handleCommit = () => {
    const trimmed = text.trim();
    if (trimmed === "") return;

    roomStore.send({
      type: "commitDraft",
      slot: cursor,
      text: trimmed,
    });
    setMyDrafts((prev) => {
      const next = [...prev];
      while (next.length < quota) next.push("");
      next[cursor] = trimmed;
      return next;
    });

    if (cursor < quota - 1) {
      // Move to next slot
      setText("");
      const next = cursor + 1;
      setCursor(next);
      roomStore.send({ type: "moveCursor", slot: next });
      setAdvanceParity((prev) => (prev === "a" ? "b" : "a"));
    } else {
      // Last slot committed — server will mark ready
      setText("");
    }
    // The card advances in place — same input node, same keyboard session —
    // so the only thing that can drop focus here is the button click itself
    // stealing it. Reclaim it on the next tick rather than relying on the
    // click never having blurred the field.
    inputRef.current?.focus({ preventScroll: true });
  };

  const handleChipTap = (slot: number) => {
    if (slot < 0 || slot >= quota || slot === cursor) return;
    // Commit current slot if it has text
    if (text.trim() !== "") {
      const trimmed = text.trim();
      roomStore.send({
        type: "commitDraft",
        slot: cursor,
        text: trimmed,
      });
      setMyDrafts((prev) => {
        const next = [...prev];
        while (next.length < quota) next.push("");
        next[cursor] = trimmed;
        return next;
      });
    }
    setText("");
    setCursor(slot);
    // Load the slot's text
    setText(myDrafts[slot] ?? "");
    // Debounced ~150ms move
    if (moveCursorTimer.current) clearTimeout(moveCursorTimer.current);
    moveCursorTimer.current = setTimeout(() => {
      roomStore.send({ type: "moveCursor", slot });
    }, 150);
    // Same alternating flag `handleCommit` uses to force the slide animation
    // to restart, so arrow taps and swipes animate the same as a commit-driven
    // advance does.
    setAdvanceParity((prev) => (prev === "a" ? "b" : "a"));
    // Same reason `handleCommit` reclaims it: the pager is a button, and a
    // click into it would otherwise blur the field and drop the keyboard for
    // a switch that is meant to stay mid-typing.
    inputRef.current?.focus({ preventScroll: true });
  };

  // Swipe left/right on the card moves between slots the same way the arrow
  // buttons do — `handleChipTap` already guards bounds and commits in-flight
  // text, so this only has to read the gesture.
  const touchStartX = useRef<number | null>(null);
  const SWIPE_THRESHOLD_PX = 40;
  const handleTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e: TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (dx <= -SWIPE_THRESHOLD_PX) handleChipTap(cursor + 1);
    else if (dx >= SWIPE_THRESHOLD_PX) handleChipTap(cursor - 1);
  };

  const handleRewriteCard = (slot: number) => {
    setText(myDrafts[slot] ?? "");
    setCursor(slot);
    roomStore.send({ type: "moveCursor", slot });
    roomStore.send({
      type: "clearDraft",
      slot,
    });
    setMyDrafts((prev) => {
      const next = [...prev];
      next[slot] = "";
      return next;
    });
    setLocalUnready(true);
  };

  return (
    <main className="screen screen--mobile screen--locked player-creating">
      <p className="plaque player-creating__plaque">Write a category</p>

      {!ready ? (
        <>
          <section
            className="card player-creating__card"
            // Tapping anywhere on the card — not just the input line itself —
            // opens the keyboard, since the input is centred and no longer
            // fills the card's whole tap target.
            onClick={() => inputRef.current?.focus({ preventScroll: true })}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {/* The card frame (border, shadow, padding) never moves — only
                its contents do, on a commit-driven advance. */}
            <div
              className={[
                "player-creating__card-inner",
                advanceParity ? `player-creating__card-inner--${advanceParity}` : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="player-creating__label">
                CATEGORY {cursor + 1} OF {quota}
              </div>
              {/* Not inside a <form>: a bare input avoids Safari's AutoFill bar
                  above the keyboard. */}
              <input
                ref={inputRef}
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  handleCommit();
                }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="player-creating__input"
              />
            </div>
          </section>

          {quota > 1 && (
            <div className="creating-pager">
              <button
                type="button"
                className="creating-pager__arrow"
                aria-label="Previous card"
                disabled={cursor === 0}
                // Same reason the commit button holds one: a mousedown into
                // the pager would blur the input before its click fires.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleChipTap(cursor - 1)}
              >
                ‹
              </button>
              <span className="creating-pager__count">
                {cursor + 1} / {quota}
              </span>
              <button
                type="button"
                className="creating-pager__arrow"
                aria-label="Next card"
                disabled={cursor === quota - 1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleChipTap(cursor + 1)}
              >
                ›
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn btn--block player-creating__commit"
            // A mousedown on the button fires before its click and would
            // blur the input first — preventing the default here is what
            // keeps the keyboard up across the advance.
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleCommit}
            disabled={text.trim() === ""}
          >
            {cursor === quota - 1 ? "DONE" : "NEXT"}
          </button>
        </>
      ) : (
        <>
          <section className="card player-voting__head">
            <span className="player-voting__avatar">{me?.emoji}</span>
            <span className="player-voting__head-text">
              <span className="player-voting__head-title">you're in</span>
              <span className="player-voting__head-sub">
                all {quota} {quota === 1 ? "card" : "cards"} written — waiting on{" "}
                {writersOf(room.players).filter(
                  (p) => p.connected && !p.ready && p.id !== playerId
                ).length}
              </span>
            </span>
          </section>

          <div className="player-creating__ready-cards">
            {myDrafts.map((draft, i) => (
              <button
                key={i}
                type="button"
                className="card player-creating__ready-card"
                onClick={() => handleRewriteCard(i)}
              >
                <span className="player-creating__ready-text">{draft}</span>
                <svg
                  className="player-creating__pen"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" />
                  <path d="M20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                </svg>
              </button>
            ))}
          </div>

          <p className="player-creating__ready-hint">
            Tap a card to rewrite it — that un-readies you.
          </p>
        </>
      )}
    </main>
  );
}
