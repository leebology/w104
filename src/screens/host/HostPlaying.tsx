import { useRemaining } from "../../net/clock";

export function HostPlaying({
  category, endsAt, offset,
}: { category: string; endsAt: number; offset: number }) {
  const remaining = useRemaining(endsAt, offset);
  return (
    <main className="host centered">
      <p className="prompt">NAME A:</p>
      <h1 className="category">{category}</h1>
      <p className="timer">{remaining}</p>
    </main>
  );
}
