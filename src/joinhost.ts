/**
 * The address to read off the TV, as the room should type it.
 *
 * Every host screen shows "JOIN AT <somewhere>", and the somewhere is read off
 * `location.host` rather than hardcoded: in production that is the real domain,
 * and during LAN testing it is the machine's IP, which is the address a phone
 * actually needs. What it must not be is a transcription of the URL bar — the
 * `www.` is four syllables the room has to say and four characters they have to
 * type, and every browser resolves the apex to it anyway.
 *
 * Stripped here rather than at the two call sites so the lobby and the room
 * chip cannot come to disagree about what the room is being told — they are the
 * same instruction on different screens.
 */
export function joinHost(): string {
  if (typeof location === "undefined") return "";
  return location.host.replace(/^www\./i, "");
}
