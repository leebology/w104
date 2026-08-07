import { useEffect, useRef, useState } from "react";
import { ABOUT_FADE_MS, AboutLink, AboutPanel } from "../../components/About";
import { AVATARS, AvatarPicker } from "../../components/AvatarPicker";
import { GetReady } from "../../components/GetReady";
import { saveProfile } from "../../net/identity";
import { roomStore } from "../../net/room";
import type { PlayerId, RoomState } from "../../../shared/state";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /** Present during the countdown phase; un-readying here still cancels it. */
  countdown?: { endsAt: number; offset: number };
  onLeave: () => void;
};

export function PlayerLobby({ room, playerId, countdown, onLeave }: Props) {
  const me = room.players.find((p) => p.id === playerId);
  const [name, setName] = useState(me?.name ?? "");
  const [emoji, setEmoji] = useState(me?.emoji ?? AVATARS[0]);

  /**
   * The about section below the two cards, and the scroll that shows it.
   *
   * The phone screen is locked to the visual viewport and never scrolls as a
   * page, so this is a box that asked for it — the same arrangement the word
   * list and the avatar strip have. Opening the section makes the box taller
   * than its frame, which is what gives the thumb something to pull.
   *
   * There are two ways out — the ✕ and scrolling back to the top — and both go
   * through `closeAbout`, because the panel does not vanish: it fades, and
   * that means it outlives the flag that opened it. `leaving` is what keeps it
   * mounted for the fade; `about` alone decides whether the link is up.
   */
  const [about, setAbout] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  /**
   * Whether the trip *down* has happened yet.
   *
   * The container is at scroll top for the frame between the state flip and
   * the programmatic scroll leaving it, and an unguarded listener would read
   * that as "scrolled back" and close what had not opened.
   */
  const armed = useRef(false);
  // Read by the scroll listener, which is attached once and must not be
  // re-subscribed on every state change — a mid-scroll re-attach would drop
  // the events the close is derived from.
  const openRef = useRef(false);
  openRef.current = about;
  const closingRef = useRef(false);

  /** Fades the panel out and takes the box back to the top with it. */
  const closeAbout = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setLeaving(true);
    scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  // The fade's own length, after which the panel is really gone. Nothing may
  // be left scrolled behind a closed section — the smooth scroll above has
  // arrived by now, and this is the backstop for a browser that skipped it.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => {
      setLeaving(false);
      setAbout(false);
      armed.current = false;
      closingRef.current = false;
      if (scroller.current) scroller.current.scrollTop = 0;
    }, ABOUT_FADE_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  // Attached once, for the lifetime of the screen: everything it needs to
  // decide with is a ref.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      if (!openRef.current || closingRef.current) return;
      // A pixel of slack, the same reason the host roster's edge test has one.
      if (el.scrollTop > 24) armed.current = true;
      else if (armed.current && el.scrollTop <= 1) closeAbout();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  /**
   * Opens it, and lands the panel's *top* edge at the top of the box.
   *
   * Not the bottom of the scroll: the panel is the thing being opened, so the
   * screen should arrive at the start of it. Measured off the two rects rather
   * than `offsetTop`, which is relative to the nearest positioned ancestor and
   * is not this box.
   */
  const openAbout = () => {
    setAbout(true);
    requestAnimationFrame(() => {
      const el = scroller.current;
      const pane = el?.querySelector(".about-pane");
      if (!el || !pane) return;
      const top =
        el.scrollTop + pane.getBoundingClientRect().top - el.getBoundingClientRect().top;
      el.scrollTo({ top, behavior: "smooth" });
    });
  };

  // No name/emoji were chosen before joining — a player picks their profile
  // here instead, and every edit is sent immediately rather than staged
  // behind a save button, so the host and roster see it update live.
  const updateProfile = (nextName: string, nextEmoji: string) => {
    roomStore.send({ type: "setProfile", name: nextName, emoji: nextEmoji });
    saveProfile(nextName, nextEmoji);
  };

  // Everything above the footer steps back under the count; the footer does
  // not. Un-readying is the room's brake on the countdown, so that button has
  // to stay lit and tappable while it runs.
  const dim = countdown ? " countdown-dim" : "";

  return (
    <main className="screen screen--mobile screen--locked player-lobby">
      {/* Gives the seat up rather than just closing the socket. A dropped
          connection deliberately leaves the player in the room, greyed out, so
          a locked phone can reclaim its seat and its words — which is the
          right answer for a phone that died and the wrong one for somebody who
          meant to leave. The message goes first: `onLeave` closes the socket,
          and anything sent after it is sent to nothing. */}
      <button
        type="button"
        className={`back-pill${dim}`}
        onClick={() => {
          roomStore.send({ type: "leaveRoom" });
          onLeave();
        }}
      >
        Leave room
      </button>

      {/* Same pill the host wears in team select, just labelled for a player
          who already knows they're in the room — no join address needed. */}
      <div className={`pill room-chip player-lobby__code-chip${dim}`}>
        <span className="room-chip__label">ROOM CODE:</span>
        <span className="room-chip__code">{room.code}</span>
      </div>

      {/* The two profile cards and the about section share one scrolling box.
          Both cards keep their place in it, so opening the section moves them
          up rather than replacing them — a player mid-way through typing a
          name has not lost the field, only pushed it above the fold. */}
      <div
        ref={scroller}
        className={
          about
            ? "player-lobby__scroll player-lobby__scroll--about"
            : "player-lobby__scroll"
        }
      >
        <section className={`card${dim}`}>
          <label className="field__label" htmlFor="player-name">Your name</label>
          <input
            id="player-name"
            className="field__input"
            value={name}
            placeholder="Type a name"
            onChange={(e) => {
              const next = e.target.value;
              setName(next);
              updateProfile(next, emoji);
            }}
            maxLength={20}
          />
        </section>

        <section className={`card${dim}`}>
          <span className="field__label">Pick an avatar</span>
          <AvatarPicker
            value={emoji}
            onChange={(next) => {
              setEmoji(next);
              updateProfile(name, next);
            }}
          />
        </section>

        {/* The link goes when the section it opens arrives: it says "there is
            more below", and below is where you now are. Scrolling back to the
            top brings both facts back at once. */}
        {!about && (
          <AboutLink className={`about-link--player${dim}`} onClick={openAbout} />
        )}

        {about && (
          <AboutPanel variant="player" leaving={leaving} onClose={closeAbout} />
        )}
      </div>

      {/* The same card the TV is showing, over the same dimmed screen. */}
      {countdown && (
        <div className="countdown-pose">
          <GetReady endsAt={countdown.endsAt} offset={countdown.offset} label="CATEGORY VOTE" />
        </div>
      )}

      <div className="player-lobby__footer">
        {/* Readying up is also the last real user gesture before the round
            starts off a server timer — see PlayerView on why that matters to
            the iOS keyboard. */}
        <button
          type="button"
          className={me?.ready ? "btn btn--secondary btn--block" : "btn btn--block"}
          onClick={() => roomStore.send({ type: "ready", ready: !me?.ready })}
        >
          {me?.ready ? "Not ready" : "Ready up"}
        </button>
      </div>
    </main>
  );
}
