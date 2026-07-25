export function ErrorScreen({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <main>
      <p className="error">{message}</p>
      <button type="button" onClick={onBack}>Back</button>
    </main>
  );
}
