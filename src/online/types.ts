export type Seat = 0 | 1;

/** A match as stored at /games/{id}. Shape and transitions are enforced by database.rules.json. */
export interface Game {
  host: string;
  guest?: string;
  hostName?: string;
  guestName?: string;
  base: number;
  inc: number;
  starter: Seat;
  createdAt: number;
  status: "waiting" | "playing" | "over";
  turn?: Seat;
  turnAt?: number;
  prevAt?: number;
  b0?: number;
  b1?: number;
  owe?: -1 | Seat;
  h0: string;
  h1: string;
  last?: string;
  winner?: -1 | Seat;
  reason?: "line" | "draw" | "time" | "resign";
  rematch?: string;
}

export interface TimeControl {
  base: number;
  inc: number;
}
