import { useRemaining } from "../../net/clock";

export function Countdown({ endsAt, offset }: { endsAt: number; offset: number }) {
  const remaining = useRemaining(endsAt, offset);
  return (
    <main className="centered">
      <h1 className="huge">{remaining}</h1>
      <p className="hint">Get ready…</p>
    </main>
  );
}
