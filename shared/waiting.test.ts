import { describe, expect, test } from "vitest";
import { inWaitingRoom, isSeated, seatedPlayers, waitingPlayers } from "./waiting";
import type { Player } from "./state";

const player = (id: string, waiting?: boolean): Player => ({
  id,
  name: id.toUpperCase(),
  emoji: "🐙",
  ready: false,
  connected: true,
  teamId: null,
  ...(waiting === undefined ? {} : { waiting }),
});

describe("inWaitingRoom", () => {
  test("an absent flag reads as seated", () => {
    // The whole reason there is no `load()` fallback: a room stored before this
    // landed has no `waiting` key anywhere, and such a room has no waiting
    // players by construction.
    expect(inWaitingRoom(player("p0"))).toBe(false);
    expect(isSeated(player("p0"))).toBe(true);
  });

  test("false reads as seated", () => {
    // `backToLobby` and the view jumper both *clear* the flag rather than
    // deleting the key, so this is the shape most seated players are in.
    expect(inWaitingRoom(player("p0", false))).toBe(false);
    expect(isSeated(player("p0", false))).toBe(true);
  });

  test("true reads as waiting", () => {
    expect(inWaitingRoom(player("p0", true))).toBe(true);
    expect(isSeated(player("p0", true))).toBe(false);
  });
});

describe("the two filters", () => {
  const roster = [player("p0"), player("p1", true), player("p2", false)];

  test("seatedPlayers keeps everyone in the match, in order", () => {
    expect(seatedPlayers(roster).map((p) => p.id)).toEqual(["p0", "p2"]);
  });

  test("waitingPlayers is exactly the complement", () => {
    expect(waitingPlayers(roster).map((p) => p.id)).toEqual(["p1"]);
  });
});
