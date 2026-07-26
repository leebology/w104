/**
 * The product's branding: two tilted plaques, not a heading. Deliberately not
 * an <h1> on the host lobby, where the room code is the real headline.
 */
export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <div className={small ? "wordmark wordmark--small" : "wordmark"}>
      <div className="wordmark__ok">OK,</div>
      <div className="wordmark__name">NAME ONE!</div>
    </div>
  );
}
