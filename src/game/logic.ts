export type Hands = [number[], number[]];
export type Difficulty = "easy" | "medium" | "hard";

export const CARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const LINES = [[1,5,9],[1,6,8],[2,4,9],[2,5,8],[2,6,7],[3,4,8],[3,5,7],[4,5,6]];

const bit = (n: number) => 1 << n;
const toMask = (cards: readonly number[]) => cards.reduce((m, n) => m | bit(n), 0);
const LINE_MASKS = LINES.map(toMask);
const FULL = toMask(CARDS);
const hasLine = (m: number) => LINE_MASKS.some(l => (m & l) === l);
const popcount = (m: number) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };

export const rnd = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
export const findLine = (hand: readonly number[]) => LINES.find(l => l.every(n => hand.includes(n))) ?? null;
export const freeCards = (hands: Hands) => CARDS.filter(n => !hands[0].includes(n) && !hands[1].includes(n));
export const winningCards = (hand: readonly number[], free: readonly number[]) =>
  free.filter(n => hasLine(toMask(hand) | bit(n)));

// Negamax over bitmasks. Positive = good for the player to move; faster wins score higher.
const memo = new Map<number, number>();
function negamax(me: number, opp: number): number {
  const key = me * 1024 + opp;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const used = me | opp;
  let best = used === FULL ? 0 : -Infinity;
  for (let n = 1; n <= 9; n++) {
    if (used & bit(n)) continue;
    const m = me | bit(n);
    const v = hasLine(m) ? 100 - popcount(m | opp) : -negamax(opp, m);
    if (v > best) best = v;
  }
  memo.set(key, best);
  return best;
}

function bestMove(me: number[], opp: number[], free: number[]) {
  const mm = toMask(me), om = toMask(opp);
  const scored = free.map(n => {
    const m = mm | bit(n);
    return { n, v: hasLine(m) ? 100 - popcount(m | om) : -negamax(om, m) };
  });
  const top = Math.max(...scored.map(s => s.v));
  return rnd(scored.filter(s => s.v === top).map(s => s.n));
}

export function aiChoose(diff: Difficulty, me: number[], opp: number[]): number {
  const free = freeCards([me, opp]);
  const wins = winningCards(me, free), threats = winningCards(opp, free);
  if (diff === "hard") return bestMove(me, opp, free);
  if (diff === "medium") {
    if (wins.length) return rnd(wins);
    if (threats.length && Math.random() < .9) return rnd(threats);
    return Math.random() < .5 ? bestMove(me, opp, free) : rnd(free);
  }
  if (wins.length && Math.random() < .6) return rnd(wins);
  if (threats.length && Math.random() < .35) return rnd(threats);
  return rnd(free);
}

// ---------- Analysis (coaching and post-game insights) ----------
export interface Move { n: number; side: 0 | 1 }

/** Moves in play order, rebuilt from both hands and who started (turns strictly alternate). */
export function moveOrder(hands: Hands, starter: 0 | 1): Move[] {
  const out: Move[] = [], next = [0, 0];
  let side = starter;
  while (next[side] < hands[side].length) {
    out.push({ n: hands[side][next[side]++], side });
    side = (1 - side) as 0 | 1;
  }
  return out;
}

/** The two cards in `hand` that make 15 with `card`. */
export const pairFor = (hand: readonly number[], card: number) =>
  LINES.find(l => l.includes(card) && l.filter(n => n !== card).every(n => hand.includes(n)))?.filter(n => n !== card) ?? [];

/** One sentence on how the game was decided, from `me`'s point of view (null if nothing notable). */
export function insight(hands: Hands, starter: 0 | 1, winner: 0 | 1 | null, me: 0 | 1, them: string): string | null {
  if (winner === null) return null;
  const Them = them[0].toUpperCase() + them.slice(1);
  const loser = (1 - winner) as 0 | 1;
  const h: Hands = [[], []];
  let missedWin: { card: number; hand: number[] } | null = null;
  let last: { threats: number[]; played: number } | null = null;
  for (const m of moveOrder(hands, starter)) {
    if (m.side === loser) {
      const free = freeCards(h), wins = winningCards(h[loser], free);
      if (wins.length && !wins.includes(m.n) && !missedWin) missedWin = { card: wins[0], hand: [...h[loser]] };
      last = { threats: winningCards(h[winner], free), played: m.n };
    }
    h[m.side].push(m.n);
  }
  const fork = last && last.threats.length >= 2 ? last.threats.slice(0, 2) : null;
  if (winner === me) return fork ? `You forked ${them}: two threats at once (${fork[0]} and ${fork[1]}). They could only block one.` : null;
  if (missedWin) {
    const [a, b] = pairFor(missedWin.hand, missedWin.card);
    return `You had a win: ${a} + ${b} + ${missedWin.card} = 15.`;
  }
  if (fork) return `${Them} had two threats at once (${fork[0]} and ${fork[1]}). You could only block one — that's a fork.`;
  if (last && last.threats.length === 1 && last.played !== last.threats[0]) return `You missed a block: ${Them} needed ${last.threats[0]}.`;
  return null;
}

/** A tip for the player to move, for coaching mode. */
export function coachTip(hands: Hands, me: 0 | 1, them: string): { text: string; win: number[]; block: number[] } {
  them = them[0].toUpperCase() + them.slice(1);
  const free = freeCards(hands), mine = hands[me], theirs = hands[1 - me];
  const wins = winningCards(mine, free), threats = winningCards(theirs, free);
  if (wins.length) {
    const [a, b] = pairFor(mine, wins[0]);
    return { text: `🎯 Take ${wins[0]} to win: ${a} + ${b} + ${wins[0]} = 15`, win: wins, block: [] };
  }
  if (threats.length >= 2) return { text: `😬 ${them} has two threats (${threats[0]} and ${threats[1]}). Block one and hope!`, win: [], block: threats };
  if (threats.length) {
    const [a, b] = pairFor(theirs, threats[0]);
    return { text: `⚠️ ${them} needs ${threats[0]} (${a} + ${b} + ${threats[0]}). Block it!`, win: [], block: threats };
  }
  if (!mine.length && !theirs.length) return { text: "👋 Pick any card. Collect three that add up to 15. Tip: 5 is in the most combos.", win: [], block: [] };
  return { text: "💡 Aim for two ways to make 15 at once — they can only block one.", win: [], block: [] };
}
