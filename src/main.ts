import "./styles.css";
import { app, localEvents, newGame, pickLocal, setDifficulty, setMode, type LocalGame, type Mode } from "./local";
import {
  challengeFriend, checkFlag, declineInvite, join, leave, match, matchEvents, move, openGame,
  resolveRematchRace, retry, serverNow, setTimeControl, shown, startChallenge, type MatchState,
} from "./online/match";
import { social, startSocial } from "./online/social";
import { clockMs, countdownLeft, fmtClock, tcLabel } from "./online/clock";
import type { Seat } from "./online/types";
import { boardView, DIFF, onlineNames } from "./view";
import { cardEl, initBoard, renderBoard } from "./ui/board";
import {
  acceptAndGo, controlAction, currentInvite, dismissInvite, gameUrl, renderControls, renderSheets,
  resultAction, savedName, saveName,
} from "./ui/sheets";
import { $, confetti, copy, share, shake, toast } from "./ui/dom";
import { emojiGrid, renderShareImage } from "./ui/shareImage";
import { isMuted, setMuted, sfx, unlockAudio } from "./ui/sound";
import { enablePush, isIOS, isStandalone } from "./online/push";
import type { Difficulty } from "./game/logic";

// ---------- Rendering: everything is derived from the stores ----------
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
social.subscribe(render);

// ---------- Reactions to state transitions ----------
let resultTimer = 0;
const showResultAfter = (ms: number) => {
  clearTimeout(resultTimer);
  resultTimer = window.setTimeout(() => app.set({ sheet: "result" }), ms);
};
/** Haptics on phones that support them (Android); follows the mute switch. */
const buzz = (pattern: number | number[]) => { if (!isMuted()) navigator.vibrate?.(pattern); };
const endSound = (winner: 0 | 1 | null, iWin: boolean) => {
  (winner === null ? sfx.draw : iWin ? sfx.win : sfx.lose)();
  if (iWin) buzz([40, 60, 40]);
};

localEvents.addEventListener("over", e => {
  const g = (e as CustomEvent<LocalGame>).detail, { mode } = app.get();
  const celebrate = (mode === "ai" && g.winner === 0) || (mode === "local" && g.winner !== null);
  if (celebrate) confetti();
  endSound(g.winner, celebrate);
  showResultAfter(g.line ? 1100 : 600);
});

match.subscribe((m, prev) => {
  if (app.get().mode !== "online") return;
  if (m.phase !== prev.phase) onPhase(m, prev);
  const myTurnNow = m.phase === "playing" && m.seat !== null && m.game?.turn === m.seat;
  if (myTurnNow && prev.game?.turn !== m.game?.turn) buzz(25);
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
      if (live) {
        const iWin = winner === 0 && m.seat !== null;
        if (iWin) confetti();
        endSound(winner, iWin || m.seat === null);
      }
      showResultAfter(live ? (line ? 1100 : 500) : 0);
    }
  }
}

// Chime when a challenge pops up (it may have been held back until a game ended).
let lastInvite: string | null = null;
const checkInvite = () => {
  const inv = currentInvite();
  if (inv && inv.gid !== lastInvite) sfx.invite();
  lastInvite = inv?.gid ?? null;
};
social.subscribe(checkInvite);
match.subscribe(checkInvite);
social.subscribe(s => resolveRematchRace(s.incoming, savedName()));

matchEvents.addEventListener("rejected", e => {
  shake(cardEl((e as CustomEvent<number>).detail));
  sfx.error();
  toast("Move rejected — your time ran out");
});
matchEvents.addEventListener("error", e => toast((e as CustomEvent<string>).detail));

// ---------- Clocks, countdown and flag claims ----------
let counting = false, lastCount = "", lastTickSec = -1;
setInterval(() => {
  const m = match.get(), sh = shown(m), g = sh?.game;
  const show = app.get().mode === "online" && !!sh && !!g && g.status !== "waiting";
  $("clock0").hidden = $("clock1").hidden = !show;
  const cd = $("countdown");
  if (!show) { cd.hidden = true; return; }
  const now = serverNow(), me = (sh.seat ?? 0) as Seat;
  [me, (1 - me) as Seat].forEach((seat, panel) => {
    const ms = clockMs(g, seat, now), el = $("clock" + panel), low = g.status === "playing" && g.turn === seat && ms < 5000;
    el.textContent = fmtClock(ms);
    el.classList.toggle("low", low);
    const sec = Math.ceil(ms / 1000);
    if (low && panel === 0 && sh.seat !== null && ms > 0 && sec !== lastTickSec) { lastTickSec = sec; sfx.tick(); buzz(12); }
  });
  const left = countdownLeft(g, now);
  cd.hidden = left <= 0;
  if (left > 0) {
    const n = String(Math.min(3, Math.ceil(left / 1000)));
    if (n !== lastCount) { lastCount = n; cd.innerHTML = `<span>${n}</span>`; sfx.count(); }
  }
  if ((left > 0) !== counting) { // countdown over: cards unlock
    counting = left > 0;
    if (!counting) { lastCount = ""; sfx.go(); }
    render();
  }
  checkFlag();
}, 100);

// ---------- Sharing ----------
/** Headline, subline and call to action for the finished game, used by the image and the caption. */
function resultSummary() {
  const { mode, diff, game } = app.get(), { winner } = boardView();
  if (mode === "online") {
    const sh = shown(match.get()), names = onlineNames(sh), opp = names[1], tc = sh ? tcLabel(sh.game) : "";
    const how = sh?.game.reason === "time" ? " on time" : sh?.game.reason === "resign" ? " by resignation" : "";
    if (sh?.seat === null) return { headline: winner === null ? "A draw" : `${names[winner]} wins`, sub: `Live match · ${tc}`, cta: "Play:" };
    if (winner === 0) return { headline: `I beat ${opp}`, sub: `Live match${how} · ${tc}`, cta: "Think you're quicker?" };
    if (winner === null) return { headline: `Draw with ${opp}`, sub: `Live match · ${tc}`, cta: "Your turn:" };
    return { headline: `${opp} beat me`, sub: `Live match${how} · ${tc}`, cta: "Rematch incoming. Play:" };
  }
  if (mode === "local") return { headline: winner === null ? "A draw" : `Player ${winner + 1} wins`, sub: "Pass & play", cta: "Play:" };
  const label = DIFF[diff].label;
  if (winner === 0) return { headline: `I beat the ${label} AI`, sub: `${label} mode · ${game.hands[0].length} picks`, cta: "Can you?" };
  if (winner === null) return diff === "hard"
    ? { headline: "I drew the unbeatable AI", sub: "Hard mode · the best possible result", cta: "Can you?" }
    : { headline: `Draw vs the ${label} AI`, sub: `${label} mode`, cta: "Your turn:" };
  return { headline: `The ${label} AI beat me`, sub: `${label} mode`, cta: "Think you can do better?" };
}

const home = () => location.origin + location.pathname;
function shareText(): string {
  const s = resultSummary(), v = boardView();
  return `${s.headline} at The 15-Game (${s.sub})\n${emojiGrid(v.hands, v.line)}\n${s.cta} ${home()}`;
}

/** Shares a picture of the final board with a caption; falls back to download + copy, then text. */
async function shareResult() {
  const s = resultSummary(), v = boardView(), text = shareText();
  const labels = v.names.map(n => n.length > 10 ? n.slice(0, 9) + "…" : n) as [string, string];
  const blob = await renderShareImage({ headline: s.headline, sub: s.sub, hands: v.hands, line: v.line, labels }).catch(() => null);
  const file = blob ? new File([blob], "the-15-game.png", { type: "image/png" }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try { return void await navigator.share({ files: [file], text }); }
    catch (e) { if ((e as Error).name === "AbortError") return; }
  }
  if (file) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return copy(text, "Image saved · caption copied");
  }
  return share(text);
}

function challengeText(): string {
  const { game: g, gameId } = match.get();
  const who = g?.hostName ? `${g.hostName} challenged` : "I'm challenging";
  return `⚔️ ${who} you to a live game of The 15-Game (${g ? tcLabel(g) : ""} per player). First to hold three numbers that add up to 15 wins.\n${gameId ? gameUrl(gameId) : home()}`;
}

// ---------- Wiring ----------
const onPick = (n: number) => (app.get().mode === "online" ? move(n) : pickLocal(n));
const nameFrom = (id: string) => {
  const name = ($(id) as HTMLInputElement).value.trim().slice(0, 20);
  if (name) saveName(name);
  return name;
};
const closeSheet = () => app.set({ sheet: null });
const goOnline = () => void startSocial().catch(() => {});

initBoard(onPick);
$("newBtn").onclick = () => controlAction().run?.();
$("againBtn").onclick = () => resultAction().run?.();
$("shareBtn").onclick = () => void shareResult();
$("resClose").onclick = () => app.set({ sheet: null });
$("status").addEventListener("click", e => {
  if ((e.target as HTMLElement).closest("[data-act=result]")) app.set({ sheet: "result" });
});
$("onlineSheet").addEventListener("click", e => {
  const edit = (e.target as HTMLElement).closest("[data-edit-name]");
  if (!edit) return;
  const show = edit.closest(".name-show") as HTMLElement, field = show.nextElementSibling as HTMLElement;
  show.hidden = true;
  field.hidden = false;
  field.querySelector("input")!.focus();
});
$("hints").onchange = e => app.set({ hints: (e.target as HTMLInputElement).checked });
document.querySelectorAll<HTMLButtonElement>("#diffSeg button").forEach(b =>
  b.onclick = () => setDifficulty(b.dataset.diff as Difficulty));
document.querySelectorAll<HTMLButtonElement>("#modeSeg button").forEach(b => b.onclick = () => {
  const mode = b.dataset.mode as Mode, current = app.get().mode;
  if (mode === "online") {
    goOnline();
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
$("olFriends").addEventListener("click", e => {
  const uid = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-uid]")?.dataset.uid;
  const friend = social.get().opponents.find(o => o.uid === uid);
  if (friend) void challengeFriend(friend, nameFrom("olName"));
});
$("olAccept").onclick = () => join(nameFrom("olName2"));
$("olShare").onclick = () => share(challengeText());
$("olCopy").onclick = () => { const id = match.get().gameId; if (id) copy(gameUrl(id), "Link copied"); };
$("rmCopy").onclick = () => { const id = match.get().gameId; if (id) copy(gameUrl(id), "Rematch link copied"); };
$("olMsgAi").onclick = () => { leave(); setMode("ai"); };
$("olMsgRetry").onclick = () => retry();
$("ipAccept").onclick = () => { const inv = currentInvite(); if (inv) acceptAndGo(inv); };
$("ipDecline").onclick = () => {
  const inv = currentInvite();
  if (!inv) return;
  dismissInvite(inv.gid);
  void declineInvite(inv);
  render();
};
$("helpBtn").onclick = () => app.set({ sheet: "help" });
$("helpClose").onclick = closeSheet;
const syncMute = () => {
  $("muteBtn").textContent = isMuted() ? "🔇" : "🔊";
  $("muteBtn").setAttribute("aria-label", isMuted() ? "Unmute sounds" : "Mute sounds");
};
$("muteBtn").onclick = () => { setMuted(!isMuted()); syncMute(); if (!isMuted()) sfx.pick(); };
syncMute();
// ---------- Install + notifications ----------
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<unknown> };
let installPrompt: InstallPrompt | null = null;
const syncInstall = () => { $("installBtn").hidden = isStandalone() || !(installPrompt || isIOS()); };
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); // show our own button instead of the browser's mini-infobar
  installPrompt = e as InstallPrompt;
  syncInstall();
});
window.addEventListener("appinstalled", () => { installPrompt = null; syncInstall(); toast("Installed — find it on your home screen"); });
$("installBtn").onclick = async () => {
  if (!installPrompt) return app.set({ sheet: "install" }); // iOS: explain Add to Home Screen
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  syncInstall();
};
$("installClose").onclick = closeSheet;
syncInstall();
document.addEventListener("click", async e => {
  const act = (e.target as HTMLElement).closest<HTMLElement>("[data-push]")?.dataset.push;
  if (act === "install") return app.set({ sheet: "install" });
  if (act !== "enable") return;
  await startSocial().catch(() => {});
  const state = await enablePush();
  toast(state === "granted" ? "🔔 You'll be notified when someone challenges you" : "Notifications weren't turned on");
  render();
});
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

for (const id of ["helpSheet", "resultSheet", "onlineSheet", "installSheet"]) {
  $(id).addEventListener("click", e => { if ((e.target as HTMLElement).id === id) closeSheet(); });
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape") return closeSheet();
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  if (/^[1-9]$/.test(e.key) && app.get().sheet === null && !currentInvite()) onPick(+e.key);
});
for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, unlockAudio, { once: true });

// ---------- Boot ----------
const linked = new URLSearchParams(location.search).get("g");
if (linked && /^[a-z0-9]{8}$/.test(linked)) {
  app.set({ mode: "online" });
  goOnline();
  void openGame(linked);
} else {
  newGame();
  // Returning online players listen for challenges from anywhere in the app.
  try { if (localStorage.getItem("pick15-online")) goOnline(); } catch {}
}
render();
