import type { Game } from "./types";

// The web config is public by design; database.rules.json controls access.
const CONFIG = {
  apiKey: "AIzaSyC9tKXepd8WWiN4cU2DzkffQCHSvp5hyGc",
  authDomain: "the-15-game-live.firebaseapp.com",
  databaseURL: "https://the-15-game-live-default-rtdb.firebaseio.com",
  projectId: "the-15-game-live",
  appId: "1:39018805752:web:8c78ab7061da624888be0d",
};

export type Unsub = () => void;
export type GameWrite = Partial<Record<keyof Game, unknown>>;

export interface Backend {
  uid: string;
  /** Best estimate of the server clock. */
  now(): number;
  serverTime: object;
  watchGame(id: string, onData: (g: Game | null) => void, onError: (e: Error) => void): Unsub;
  readGame(id: string): Promise<Game | null>;
  createGame(id: string, g: GameWrite): Promise<void>;
  updateGame(id: string, patch: GameWrite): Promise<void>;
  watchConnected(cb: (connected: boolean) => void): Unsub;
  /** Sets `path` to true while connected (false on disconnect); returns a function that clears it. */
  announce(path: string): Unsub;
  watch<T = unknown>(path: string, cb: (value: T | null) => void): Unsub;
  write(path: string, value: unknown): Promise<void>;
  remove(path: string): Promise<void>;
}

let pending: Promise<Backend> | null = null;

/** Loads the Firebase SDK on first use (it's split into its own chunk) and signs in anonymously. */
export function connect(): Promise<Backend> {
  pending ??= init().catch(e => { pending = null; throw e; });
  return pending;
}

async function init(): Promise<Backend> {
  const [{ initializeApp }, authSdk, db] = await Promise.all([
    import("firebase/app"), import("firebase/auth"), import("firebase/database"),
  ]);
  const app = initializeApp(CONFIG);
  const auth = authSdk.getAuth(app);
  await auth.authStateReady(); // reuse the same anonymous player after a reload
  const user = auth.currentUser ?? (await authSdk.signInAnonymously(auth)).user;
  const database = db.getDatabase(app);
  const gameRef = (id: string) => db.ref(database, `games/${id}`);

  let offset = 0;
  db.onValue(db.ref(database, ".info/serverTimeOffset"), s => { offset = s.val() ?? 0; });
  const watchConnected = (cb: (c: boolean) => void) =>
    db.onValue(db.ref(database, ".info/connected"), s => cb(!!s.val()));

  return {
    uid: user.uid,
    now: () => Date.now() + offset,
    serverTime: db.serverTimestamp(),
    watchGame: (id, onData, onError) => db.onValue(gameRef(id), s => onData(s.val()), onError),
    readGame: async id => (await db.get(gameRef(id))).val(),
    createGame: (id, g) => db.set(gameRef(id), g),
    updateGame: (id, patch) => db.update(gameRef(id), patch),
    watchConnected,
    announce(path) {
      const mine = db.ref(database, path);
      const off = watchConnected(c => {
        if (!c) return;
        db.onDisconnect(mine).set(false);
        db.set(mine, true).catch(() => {});
      });
      return () => {
        off();
        db.onDisconnect(mine).cancel().catch(() => {});
        db.set(mine, false).catch(() => {});
      };
    },
    watch: (path, cb) => db.onValue(db.ref(database, path), s => cb(s.val()), () => cb(null)),
    write: (path, value) => db.set(db.ref(database, path), value),
    remove: path => db.remove(db.ref(database, path)),
  };
}
