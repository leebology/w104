import PartySocket from "partysocket";
import "./style.css";

// In production this is set by Vercel (e.g. "w104.<your-login>.partykit.dev").
// In local dev it falls back to the `partykit dev` server on :1999.
const host = import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";

type ServerMessage =
  | { type: "presence"; count: number }
  | { type: "wave"; from: string };

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main>
    <h1>w104</h1>
    <p class="tagline">Making lists is more fun with friends.</p>
    <p class="status">status: <span id="status">connecting…</span></p>
    <p><strong id="count">0</strong> connected</p>
    <button id="wave" type="button">Wave 👋</button>
    <ul id="log"></ul>
  </main>
`;

const statusEl = document.querySelector<HTMLSpanElement>("#status")!;
const countEl = document.querySelector<HTMLElement>("#count")!;
const logEl = document.querySelector<HTMLUListElement>("#log")!;

// One shared "lobby" room for now. Real games will use per-game room codes.
const socket = new PartySocket({ host, room: "lobby" });

socket.addEventListener("open", () => {
  statusEl.textContent = "connected";
});
socket.addEventListener("close", () => {
  statusEl.textContent = "disconnected";
});
socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data as string) as ServerMessage;
  if (msg.type === "presence") {
    countEl.textContent = String(msg.count);
  } else if (msg.type === "wave") {
    const li = document.createElement("li");
    li.textContent = `👋 from ${msg.from}`;
    logEl.prepend(li);
  }
});

document
  .querySelector<HTMLButtonElement>("#wave")!
  .addEventListener("click", () => {
    socket.send(JSON.stringify({ type: "wave" }));
  });
