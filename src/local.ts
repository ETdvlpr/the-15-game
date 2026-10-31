import { createStore } from "./store";
import { aiChoose, findLine, freeCards, type Difficulty, type Hands } from "./game/logic";

export type Mode = "ai" | "local" | "online";
export type Sheet = "help" | "result" | "online" | null;
export type Side = 0 | 1;

export interface LocalGame {
  id: number;
  hands: Hands;
  turn: Side;
  over: boolean;
  winner: Side | null;
  line: number[] | null;
  thinking: boolean;
}

export interface AppState {
  mode: Mode;
  diff: Difficulty;
  hints: boolean;
  nextStarter: Side;
  game: LocalGame;
  sheet: Sheet;
}

const emptyGame = (id: number, turn: Side): LocalGame =>
  ({ id, hands: [[], []], turn, over: false, winner: null, line: null, thinking: false });

export const app = createStore<AppState>({
  mode: "ai", diff: "medium", hints: false, nextStarter: 0, game: emptyGame(0, 0), sheet: null,
});

/** Fired when a local game ends (detail: LocalGame). */
export const localEvents = new EventTarget();

// ---------- Stats (per-viewer convenience only) ----------
export type Record3 = { w: number; d: number; l: number };
export interface Stats { easy?: Record3; medium?: Record3; hard?: Record3; streak?: number }

export function loadStats(): Stats {
  try { return JSON.parse(localStorage.getItem("pick15-stats") ?? "{}") ?? {}; } catch { return {}; }
}
function record(diff: Difficulty, result: keyof Record3) {
  const stats = loadStats();
  const d = stats[diff] ?? { w: 0, d: 0, l: 0 };
  d[result]++;
  stats[diff] = d;
  stats.streak = result === "w" ? (stats.streak ?? 0) + 1 : result === "d" ? stats.streak ?? 0 : 0;
  try { localStorage.setItem("pick15-stats", JSON.stringify(stats)); } catch {}
}

// ---------- Actions ----------
let aiTimer = 0;

export function newGame() {
  const s = app.get();
  if (s.mode === "online") return;
  clearTimeout(aiTimer);
  const turn = s.nextStarter;
  app.set({ nextStarter: (1 - turn) as Side, sheet: null, game: emptyGame(s.game.id + 1, turn) });
  if (s.mode === "ai" && turn === 1) aiTurn();
}

export function pickLocal(n: number) {
  const { game, mode } = app.get();
  if (game.over || game.thinking || !freeCards(game.hands).includes(n)) return;
  if (mode === "ai" && game.turn !== 0) return;
  play(n);
}

function play(n: number) {
  const { game, mode, diff } = app.get();
  const p = game.turn;
  const hands: Hands = [[...game.hands[0]], [...game.hands[1]]];
  hands[p].push(n);
  const line = findLine(hands[p]);
  if (line || freeCards(hands).length === 0) {
    const over = { ...game, hands, over: true, winner: line ? p : null, line, thinking: false };
    app.set({ game: over });
    if (mode === "ai") record(diff, over.winner === 0 ? "w" : over.winner === 1 ? "l" : "d");
    localEvents.dispatchEvent(new CustomEvent("over", { detail: over }));
    return;
  }
  app.set({ game: { ...game, hands, turn: (1 - p) as Side } });
  if (mode === "ai" && p === 0) aiTurn();
}

function aiTurn() {
  const id = app.get().game.id;
  app.set(s => ({ game: { ...s.game, thinking: true } }));
  aiTimer = window.setTimeout(() => {
    const { game, diff } = app.get();
    if (game.id !== id) return;
    app.set({ game: { ...game, thinking: false } });
    play(aiChoose(diff, game.hands[1], game.hands[0]));
  }, 550 + Math.random() * 450);
}

export function setMode(mode: Mode) {
  clearTimeout(aiTimer);
  app.set(s => ({ mode, nextStarter: 0, sheet: null, game: emptyGame(s.game.id + 1, 0) }));
  newGame();
}

export function setDifficulty(diff: Difficulty) {
  app.set({ diff, nextStarter: 0 });
  newGame();
}
