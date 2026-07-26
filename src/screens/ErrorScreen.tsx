export function ErrorScreen({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <main className="screen screen--centered">
      <div className="card centered-card">
        <p className="notice">{message}</p>
        <button type="button" className="btn btn--block" onClick={onBack}>
          Try again
        </button>
      </div>
    </main>
  );
}
