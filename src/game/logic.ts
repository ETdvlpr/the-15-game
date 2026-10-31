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
