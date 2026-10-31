import "./styles.css";
import { app, localEvents, newGame, pickLocal, setDifficulty, setMode, type LocalGame, type Mode } from "./local";
import {
  acceptRematch, checkFlag, join, leave, match, matchEvents, move, openGame, retry,
  serverNow, setTimeControl, shown, startChallenge, type MatchState,
} from "./online/match";
import { clockMs, countdownLeft, fmtClock, tcLabel } from "./online/clock";
import type { Seat } from "./online/types";
import { boardView, DIFF, onlineNames } from "./view";
import { cardEl, initBoard, renderBoard } from "./ui/board";
import { controlAction, gameUrl, renderControls, renderSheets, resultAction, saveName } from "./ui/sheets";
import { $, confetti, copy, share, shake, toast } from "./ui/dom";
import type { Difficulty } from "./game/logic";

// ---------- Rendering: everything is derived from the two stores ----------
let queued = false;
function render() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    renderBoard(boardView());
    renderControls();
    renderSheets();
  });
}
app.subscribe(render);
match.subscribe(render);

// ---------- Reactions to state transitions ----------
let resultTimer = 0;
const showResultAfter = (ms: number) => {
  clearTimeout(resultTimer);
  resultTimer = window.setTimeout(() => app.set({ sheet: "result" }), ms);
};

localEvents.addEventListener("over", e => {
  const g = (e as CustomEvent<LocalGame>).detail, { mode } = app.get();
  if ((mode === "ai" && g.winner === 0) || (mode === "local" && g.winner !== null)) confetti();
  showResultAfter(g.line ? 1100 : 600);
});

match.subscribe((m, prev) => {
  if (app.get().mode !== "online" || m.phase === prev.phase) return;
  onPhase(m, prev);
});

function onPhase(m: MatchState, prev: MatchState) {
  switch (m.phase) {
    case "idle":
    case "error":
      app.set({ sheet: "online" });
      break;
    case "connecting":
    case "waiting":
    case "invited":
      if (!m.prev) app.set({ sheet: "online" }); // rematches are handled inside the result sheet
      break;
    case "playing":
      clearTimeout(resultTimer);
      app.set({ sheet: null });
      break;
    case "over": {
      const live = prev.phase === "playing", { winner, line } = boardView();
      if (live && winner === 0 && m.seat !== null) confetti();
      showResultAfter(live ? (line ? 1100 : 500) : 0);
    }
  }
}

matchEvents.addEventListener("rejected", e => {
  shake(cardEl((e as CustomEvent<number>).detail));
  toast("Move rejected — your time ran out");
});
matchEvents.addEventListener("error", e => toast((e as CustomEvent<string>).detail));

// ---------- Clocks, countdown and flag claims ----------
let counting = false;
setInterval(() => {
  const m = match.get(), sh = shown(m), g = sh?.game;
  const show = app.get().mode === "online" && !!sh && !!g && g.status !== "waiting";
  $("clock0").hidden = $("clock1").hidden = !show;
  const cd = $("countdown");
  if (!show) { cd.hidden = true; return; }
  const now = serverNow(), me = (sh.seat ?? 0) as Seat;
  [me, (1 - me) as Seat].forEach((seat, panel) => {
    const ms = clockMs(g, seat, now), el = $("clock" + panel);
    el.textContent = fmtClock(ms);
    el.classList.toggle("low", g.status === "playing" && g.turn === seat && ms < 5000);
  });
  const left = countdownLeft(g, now);
  cd.hidden = left <= 0;
  if (left > 0) {
    const n = String(Math.min(3, Math.ceil(left / 1000)));
    if (cd.textContent !== n) cd.innerHTML = `<span>${n}</span>`;
  }
  if ((left > 0) !== counting) { counting = left > 0; render(); } // countdown over: cards unlock
  checkFlag();
}, 100);

// ---------- Sharing ----------
function shareText(): string {
  const { mode, diff, game } = app.get();
  const home = location.origin + location.pathname;
  const { winner, line } = boardView();
  const eq = line ? `${line.join(" + ")} = 15` : "";
  if (mode === "online") {
    const sh = shown(match.get()), opp = onlineNames(sh)[1], tc = sh ? ` (${tcLabel(sh.game)})` : "";
    if (sh?.seat === null) return `👀 Just watched a live game of The 15-Game${tc}\n${home}`;
    if (winner === 0) return `🏆 I beat ${opp} in a live game of The 15-Game${tc}${eq ? "\n" + eq : ""}\nThink you're quicker? ${home}`;
    if (winner === null) return `🤝 Drew ${opp} in a live game of The 15-Game${tc}\n${home}`;
    return `⏱ ${opp} beat me in a live game of The 15-Game${tc}. Rematch incoming.\n${home}`;
  }
  if (mode === "local") return `Just played The 15-Game — ${winner === null ? "a draw!" : `Player ${winner + 1} won with ${eq}`}\n${home}`;
  const label = DIFF[diff].label;
  if (winner === 0) return `🏆 I beat the ${label} AI at The 15-Game in ${game.hands[0].length} picks\n${eq}\nCan you? ${home}`;
  if (winner === null) return diff === "hard"
    ? `🤝 I held the unbeatable AI to a draw at The 15-Game\nCan you? ${home}`
    : `🤝 Drew the ${label} AI at The 15-Game\nYour turn: ${home}`;
  return `🤖 The ${label} AI beat me at The 15-Game\nThink you can do better? ${home}`;
}

function challengeText(): string {
  const { game: g, gameId } = match.get();
  const who = g?.hostName ? `${g.hostName} challenged` : "I'm challenging";
  return `⚔️ ${who} you to a live game of The 15-Game (${g ? tcLabel(g) : ""} per player). First to hold three numbers that add up to 15 wins.\n${gameId ? gameUrl(gameId) : ""}`;
}

// ---------- Wiring ----------
const onPick = (n: number) => (app.get().mode === "online" ? move(n) : pickLocal(n));
const nameFrom = (id: string) => {
  const name = ($(id) as HTMLInputElement).value.trim().slice(0, 20);
  if (name) saveName(name);
  return name;
};
const closeSheet = () => app.set({ sheet: null });

initBoard(onPick);
$("newBtn").onclick = () => controlAction().run?.();
$("againBtn").onclick = () => resultAction().run?.();
$("shareBtn").onclick = () => share(shareText());
$("hints").onchange = e => app.set({ hints: (e.target as HTMLInputElement).checked });
document.querySelectorAll<HTMLButtonElement>("#diffSeg button").forEach(b =>
  b.onclick = () => setDifficulty(b.dataset.diff as Difficulty));
document.querySelectorAll<HTMLButtonElement>("#modeSeg button").forEach(b => b.onclick = () => {
  const mode = b.dataset.mode as Mode, current = app.get().mode;
  if (mode === "online") {
    if (current !== "online") setMode("online");
    if (match.get().phase === "idle") app.set({ sheet: "online" });
    return;
  }
  if (current === "online") leave();
  setMode(mode);
});
document.querySelectorAll<HTMLButtonElement>("#tcSeg button").forEach(b =>
  b.onclick = () => setTimeControl({ base: +b.dataset.base!, inc: +b.dataset.inc! }));
$("olCreateBtn").onclick = () => startChallenge(nameFrom("olName"));
$("olAccept").onclick = () => join(nameFrom("olName2"));
$("olShare").onclick = () => share(challengeText());
$("olCopy").onclick = () => { const id = match.get().gameId; if (id) copy(gameUrl(id), "Link copied"); };
$("rmCopy").onclick = () => { const id = match.get().gameId; if (id) copy(gameUrl(id), "Rematch link copied"); };
$("olMsgAi").onclick = () => { leave(); setMode("ai"); };
$("olMsgRetry").onclick = () => retry();
$("rematchBarBtn").onclick = () => { app.set({ sheet: "result" }); void acceptRematch(); };
$("helpBtn").onclick = () => app.set({ sheet: "help" });
$("helpClose").onclick = closeSheet;
for (const id of ["helpSheet", "resultSheet", "onlineSheet"]) {
  $(id).addEventListener("click", e => { if ((e.target as HTMLElement).id === id) closeSheet(); });
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape") return closeSheet();
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  if (/^[1-9]$/.test(e.key) && app.get().sheet === null) onPick(+e.key);
});

// ---------- Boot ----------
const linked = new URLSearchParams(location.search).get("g");
if (linked && /^[a-z0-9]{8}$/.test(linked)) {
  app.set({ mode: "online" });
  void openGame(linked);
} else {
  newGame();
  try {
    if (!localStorage.getItem("pick15-seen")) {
      app.set({ sheet: "help" });
      localStorage.setItem("pick15-seen", "1");
    }
  } catch {}
}
render();
