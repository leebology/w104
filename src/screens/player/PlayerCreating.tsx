import { useEffect, useRef, useState } from "react";
import { formatClock, useRemaining } from "../../net/clock";
import { roomStore } from "../../net/room";
import { quotaFor, WRITE_MS, MAX_CATEGORY_LEN } from "../../../shared/customCategories";
import type { RoomState } from "../../../shared/state";
import type { PlayerId } from "../../../shared/state";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  drafts: string[];
  offset: number;
};

export function PlayerCreating({ room, playerId, drafts, offset }: Props) {
  const me = room.players.find((p) => p.id === playerId);
  const quota = quotaFor(room.players.length, room.settings.roundCount);

  // In-flight text for the current slot
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Count committed cards (non-empty after trim) — feeds the "N to write"
  // total only. Per-slot state (pips, pager chips) reads `drafts[i]` itself,
  // since the pager lets a player jump to any slot out of order.
  const committed = drafts.filter((d) => d.trim() !== "").length;
  // The Durable Object is the sole authority: `writeSlot` in shared/reduce.ts
  // sets `ready` once every slot is committed, so the client reads it back
  // rather than re-deriving it from `drafts`.
  const ready = me?.ready === true;

  const endsAt = room.phase.name === "creating" ? room.phase.endsAt : 0;
  const remaining = useRemaining(endsAt, offset, room.paused);

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

  const handleCommit = () => {
    const trimmed = text.trim();
    if (trimmed === "") return;

    roomStore.send({
      type: "commitDraft",
      slot: cursor,
      text: trimmed,
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
  };

  const handleChipTap = (slot: number) => {
    // Commit current slot if it has text
    if (text.trim() !== "") {
      roomStore.send({
        type: "commitDraft",
        slot: cursor,
        text: text.trim(),
      });
    }
    setText("");
    setCursor(slot);
    // Load the slot's text
    setText(drafts[slot] ?? "");
    // Debounced ~150ms move
    if (moveCursorTimer.current) clearTimeout(moveCursorTimer.current);
    moveCursorTimer.current = setTimeout(() => {
      roomStore.send({ type: "moveCursor", slot });
    }, 150);
  };

  const handleRewriteCard = (slot: number) => {
    setText(drafts[slot] ?? "");
    setCursor(slot);
    roomStore.send({
      type: "clearDraft",
      slot,
    });
  };

  const still = quota - committed;

  return (
    <main className="screen screen--mobile screen--locked player-creating">
      <div className="player-creating__meta">
        ROOM {room.code} · WRITE {quota}
      </div>

      {!ready ? (
        <>
          <section className="card player-voting__head">
            <span className="player-voting__count">{still}</span>
            <span className="player-voting__head-text">
              <span className="player-voting__head-title">to write</span>
              <span className="player-voting__pips">
                {Array.from({ length: quota }, (_, i) => (
                  <span
                    key={i}
                    className={(drafts[i] ?? "").trim() !== "" ? "pip pip--spent" : "pip"}
                  />
                ))}
              </span>
            </span>
          </section>

          <section className="card player-creating__card">
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
                CARD {cursor + 1} OF {quota}
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
                maxLength={MAX_CATEGORY_LEN}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="player-creating__input"
                autoFocus={cursor === 0}
              />
              <div className="player-creating__counter">
                {text.length} / {MAX_CATEGORY_LEN}
              </div>
            </div>
          </section>

          {quota > 1 && (
            <div className="slot-strip">
              {Array.from({ length: quota }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={[
                    "slot-strip__chip",
                    i === cursor ? "slot-strip__chip--current" : "",
                    (drafts[i] ?? "").trim() !== "" ? "slot-strip__chip--done" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => handleChipTap(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            className="btn btn--block player-creating__commit"
            onClick={handleCommit}
          >
            {cursor === quota - 1 ? "DONE" : "NEXT"}
          </button>

          <div className="timer-bar player-voting__bar">
            <span className="timer-bar__num">{formatClock(remaining)}</span>
            <span className="timer-track">
              <span
                className="timer-track__fill"
                style={{
                  width: `${Math.min(
                    100,
                    (remaining / (WRITE_MS / 1000)) * 100
                  )}%`,
                }}
              />
            </span>
          </div>
        </>
      ) : (
        <>
          <section className="card player-voting__head">
            <span className="player-voting__avatar">{me?.emoji}</span>
            <span className="player-voting__head-text">
              <span className="player-voting__head-title">you're in</span>
              <span className="player-voting__head-sub">
                all {quota} {quota === 1 ? "card" : "cards"} written — waiting on{" "}
                {room.players.filter(
                  (p) => p.connected && !p.ready && p.id !== playerId
                ).length}
              </span>
            </span>
          </section>

          <div className="player-creating__ready-cards">
            {drafts.map((draft, i) => (
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

          <div className="timer-bar player-voting__bar">
            <span className="timer-bar__num">{formatClock(remaining)}</span>
            <span className="timer-track">
              <span
                className="timer-track__fill"
                style={{
                  width: `${Math.min(
                    100,
                    (remaining / (WRITE_MS / 1000)) * 100
                  )}%`,
                }}
              />
            </span>
          </div>
        </>
      )}
    </main>
  );
}
