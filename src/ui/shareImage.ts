import type { Hands } from "../game/logic";

export interface ShareCard {
  headline: string;
  sub: string;
  hands: Hands;
  line: number[] | null;
  /** Short labels for each side's cards, e.g. ["You", "AI"]. */
  labels: [string, string];
}

const C = { bg: "#0e1320", glow: "#1f2d52", text: "#eef1f7", muted: "#8b94ab", card: "#f6efe2", ink: "#1a2032", you: "#2fd4a7", them: "#ff7a5c", gold: "#ffcf5c" };
const SERIF = "Fraunces, Georgia, serif";
const SANS = '"Space Grotesk", system-ui, sans-serif';

function roundRect(x: CanvasRenderingContext2D, left: number, top: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(left + r, top);
  x.arcTo(left + w, top, left + w, top + h, r);
  x.arcTo(left + w, top + h, left, top + h, r);
  x.arcTo(left, top + h, left, top, r);
  x.arcTo(left, top, left + w, top, r);
  x.closePath();
}

/** Renders the final board as a square PNG for sharing. */
export async function renderShareImage(card: ShareCard): Promise<Blob | null> {
  await Promise.all([document.fonts.load(`800 64px Fraunces`), document.fonts.load(`500 30px "Space Grotesk"`)]).catch(() => {});
  const W = 1080, H = 1080, canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const x = canvas.getContext("2d");
  if (!x) return null;

  x.fillStyle = C.bg;
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, -80, 40, W / 2, 0, 950);
  glow.addColorStop(0, C.glow);
  glow.addColorStop(1, "rgba(14,19,32,0)");
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);

  x.textAlign = "center";
  x.fillStyle = C.muted;
  x.font = `700 34px ${SANS}`;
  x.fillText("THE 15-GAME", W / 2, 96);
  x.fillStyle = C.gold;
  let fontSize = 78;
  do x.font = `800 ${fontSize}px ${SERIF}`; while (x.measureText(card.headline).width > W - 120 && (fontSize -= 4) > 40);
  x.fillText(card.headline, W / 2, 196);
  x.fillStyle = C.muted;
  x.font = `500 34px ${SANS}`;
  x.fillText(card.sub, W / 2, 250);

  const size = 168, gap = 22, left = (W - (3 * size + 2 * gap)) / 2, top = 300;
  for (let n = 1; n <= 9; n++) {
    const cx = left + ((n - 1) % 3) * (size + gap), cy = top + Math.floor((n - 1) / 3) * (size + gap);
    const owner = card.hands[0].includes(n) ? 0 : card.hands[1].includes(n) ? 1 : null;
    const trio = !!card.line?.includes(n);
    roundRect(x, cx, cy, size, size, 26);
    x.fillStyle = owner === null ? "rgba(246,239,226,.08)" : C.card;
    x.fill();
    if (owner !== null) {
      x.save();
      x.clip();
      x.fillStyle = owner === 0 ? C.you : C.them;
      x.fillRect(cx, cy + size - 16, size, 16);
      x.restore();
    }
    if (trio) {
      x.lineWidth = 8;
      x.strokeStyle = C.gold;
      roundRect(x, cx - 4, cy - 4, size + 8, size + 8, 30);
      x.stroke();
    }
    x.fillStyle = owner === null ? "rgba(246,239,226,.3)" : C.ink;
    x.font = `800 96px ${SERIF}`;
    x.fillText(String(n), cx + size / 2, cy + size / 2 + 30);
    if (owner !== null) {
      x.font = `700 22px ${SANS}`;
      x.fillStyle = owner === 0 ? "#127a5f" : "#b4442a";
      x.fillText(card.labels[owner], cx + size / 2, cy + 34);
    }
  }

  const bottom = top + 3 * size + 2 * gap;
  if (card.line) {
    x.fillStyle = C.gold;
    x.font = `800 62px ${SERIF}`;
    x.fillText(`${card.line.join(" + ")} = 15`, W / 2, bottom + 92);
  }
  x.fillStyle = C.muted;
  x.font = `500 30px ${SANS}`;
  x.fillText(`Can you beat it? · ${location.host}`, W / 2, H - 46);

  return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

/** Wordle-style grid of the board: 🟨 winning trio, 🟩 yours, 🟥 theirs, ⬜ untaken. */
export function emojiGrid(hands: Hands, line: number[] | null) {
  const cell = (n: number) => line?.includes(n) ? "🟨" : hands[0].includes(n) ? "🟩" : hands[1].includes(n) ? "🟥" : "⬜";
  return [0, 1, 2].map(r => [1, 2, 3].map(c => cell(r * 3 + c)).join("")).join("\n");
}
