import { app, type Side } from "./local";
import { canMove, match, serverNow, shown, type Shown } from "./online/match";
import { countdownLeft, tcLabel } from "./online/clock";
import { findLine, freeCards, winningCards, type Hands } from "./game/logic";

export const DIFF = {
  easy:   { label: "Easy",   persona: "Casual · makes mistakes" },
  medium: { label: "Medium", persona: "Sharp · blocks your threats" },
  hard:   { label: "Hard",   persona: "Unbeatable · try for a draw" },
} as const;

export interface BoardView {
  /** Changes whenever a different game is on the board (triggers the deal animation). */
  key: string;
  hands: Hands;
  /** Side whose turn it is, or null when nobody is on the clock. */
  active: Side | null;
  winner: Side | null;
  line: number[] | null;
  names: [string, string];
  avatars: [string, string];
  subtitle: string; // html, opponent panel
  canPick: boolean;
  hints: { win: number[]; block: number[]; needs: [number[], number[]] } | null;
  status: string; // html
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const digits = (s = "") => [...s].map(Number);
const hl = (side: Side, text: string) => `<span class="${side === 0 ? "hl-you" : "hl-ai"}">${text}</span>`;
const dots = (text: string, cls = "") => `<span class="dots ${cls}">${text}</span>`;
const spin = (text: string) => `<span class="spinner"></span>${text}`;

export function onlineNames(sh: Shown | null): [string, string] {
  const g = sh?.game;
  if (!g) return ["You", "Opponent"];
  if (sh.seat === null) return [g.hostName || "Player 1", g.guestName || "Player 2"];
  return ["You", (sh.seat === 0 ? g.guestName : g.hostName) || "Opponent"];
}

export function boardView(): BoardView {
  return app.get().mode === "online" ? onlineView() : localView();
}

function localView(): BoardView {
  const { mode, game: g, hints, diff } = app.get();
  const ai = mode === "ai";
  const names: [string, string] = ai ? ["You", "AI"] : ["Player 1", "Player 2"];
  const canPick = !g.over && !g.thinking && !(ai && g.turn === 1);
  const free = freeCards(g.hands);
  const needs: [number[], number[]] = [winningCards(g.hands[0], free), winningCards(g.hands[1], free)];
  const win = canPick ? needs[g.turn] : [];
  const status = g.over
    ? g.winner === null ? "It's a draw" : hl(g.winner, g.winner === 0 && ai ? "You win!" : `${names[g.winner]} wins`)
    : g.thinking ? dots("AI is thinking", "hl-ai")
    : ai ? `${hl(0, g.hands[0].length + g.hands[1].length === 0 ? "You go first" : "Your turn")} — pick a card`
    : `${hl(g.turn, names[g.turn])} — your turn`;
  return {
    key: `local-${g.id}`,
    hands: g.hands,
    active: g.over ? null : g.turn,
    winner: g.winner,
    line: g.line,
    names,
    avatars: ai ? ["You", "AI"] : ["P1", "P2"],
    subtitle: ai ? DIFF[diff].persona : "",
    canPick,
    hints: hints && !g.over ? { win, block: canPick ? needs[1 - g.turn].filter(n => !win.includes(n)) : [], needs } : null,
    status,
  };
}

function onlineView(): BoardView {
  const m = match.get(), sh = shown(m), g = sh?.game ?? null;
  const me = sh?.seat ?? 0, opp = 1 - me;
  const names = onlineNames(sh);
  const hands: Hands = g ? [digits(me === 0 ? g.h0 : g.h1), digits(opp === 0 ? g.h0 : g.h1)] : [[], []];
  const over = g?.status === "over";
  const winner: Side | null = !over || g!.winner === -1 || g!.winner === undefined ? null : g!.winner === me ? 0 : 1;
  const turn: Side = g?.turn === undefined || g.turn === me ? 0 : 1;
  const spectator = sh !== null && sh.seat === null;

  let subtitle = "";
  if (g && g.status !== "waiting") {
    const presence = spectator || m.oppOnline === null ? ""
      : `<span class="presence ${m.oppOnline ? "on" : ""}"></span>${m.oppOnline ? "online" : "offline"} · `;
    subtitle = presence + tcLabel(g);
  }

  const opponent = esc(names[1]);
  let status: string;
  switch (m.phase) {
    case "idle": status = "Create a challenge to play live"; break;
    case "connecting": status = spin(m.rematch === "accepting" ? "Starting the rematch…" : m.prev ? "Setting up the rematch…" : "Connecting…"); break;
    case "waiting": status = m.prev ? dots(`Waiting for ${opponent} to accept`) : dots("Waiting for an opponent"); break;
    case "invited": status = m.prev ? spin("Starting the rematch…") : "You've been challenged"; break;
    case "joining": status = spin(m.prev ? "Starting the rematch…" : "Joining…"); break;
    case "error": status = esc(m.error?.title ?? "Something went wrong"); break;
    case "over":
      status = winner === null ? "It's a draw"
        : hl(winner, winner === 0 && !spectator ? "You win!" : `${esc(names[winner])} wins`);
      break;
    case "playing":
      status = countdownLeft(g!, serverNow()) > 0 ? "Get ready…"
        : spectator ? `${hl(turn, esc(names[turn]))} to move · watching`
        : turn === 0 ? `${hl(0, "Your move")} — the clock is running`
        : dots(`${opponent} is thinking`, "hl-ai");
  }

  return {
    key: `online-${sh?.id ?? "none"}`,
    hands,
    active: m.phase === "playing" ? turn : null,
    winner,
    line: winner === null ? null : findLine(hands[winner]),
    names,
    avatars: spectator || !g ? ["P1", "P2"] : ["You", names[1][0].toUpperCase()],
    subtitle,
    canPick: canMove(m),
    hints: null,
    status,
  };
}
