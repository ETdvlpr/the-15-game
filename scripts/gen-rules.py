#!/usr/bin/env python3
"""Generates database.rules.json for live matches.

Clock model (no server code needed):
  - turnAt  = server time the current turn started, prevAt = when the previous turn started.
  - b0/b1   = each seat's time bank. A mover can't know the server time of their own move,
              so their bank is settled by the *next* move: b -= (turnAt - prevAt), b += inc.
  - owe     = seat whose bank is still unsettled (-1 before the first move).
Every branch below is checked against the server's `now`, so clients can't fake time.
"""
import json
from pathlib import Path

GRACE = 1500  # ms of latency allowance for a move (and before a time-out can be claimed)
COUNTDOWN = 3000  # first mover gets base + 3s to cover the 3-2-1 countdown
LINES = [(1,5,9),(1,6,8),(2,4,9),(2,5,8),(2,6,7),(3,4,8),(3,5,7),(4,5,6)]
FIELDS = ["host","guest","hostName","guestName","invitee","base","inc","starter","createdAt","status",
          "turn","turnAt","prevAt","b0","b1","owe","h0","h1","last","winner","reason","rematch"]

D = lambda f: f"data.child('{f}').val()"
N = lambda f: f"newData.child('{f}').val()"
same = lambda f: f"{N(f)} == {D(f)}"
AND = lambda *xs: "(" + " && ".join(xs) + ")"
OR = lambda *xs: "(" + " || ".join(xs) + ")"
def same_except(*changed): return AND(*[same(f) for f in FIELDS if f not in changed])
def nulls(*fs): return AND(*[f"{N(f)} == null" for f in fs])
seat_uid = lambda p: D("host") if p == 0 else D("guest")
is_player = OR(f"auth.uid == {D('host')}", f"auth.uid == {D('guest')}")
def has_line(h): return OR(*[AND(*[f"{h}.contains('{n}')" for n in l]) for l in LINES])

create = AND(
    "!data.exists()",
    f"{N('host')} == auth.uid",
    f"{N('status')} == 'waiting'",
    OR(*[f"{N('base')} == {b}" for b in (15000, 30000, 60000)]),
    OR(*[f"{N('inc')} == {i}" for i in (1000, 2000, 3000)]),
    OR(f"{N('starter')} == 0", f"{N('starter')} == 1"),
    f"{N('createdAt')} == now",
    f"{N('h0')} == ''", f"{N('h1')} == ''",
    f"{N('invitee')} != auth.uid",
    nulls("guest","guestName","turn","turnAt","prevAt","b0","b1","owe","last","winner","reason","rematch"),
)

join = AND(
    f"{D('status')} == 'waiting'", f"{D('guest')} == null", f"auth.uid != {D('host')}",
    OR(f"{D('invitee')} == null", f"{D('invitee')} == auth.uid"),  # direct challenges: only the invitee
    f"{N('guest')} == auth.uid",
    f"{N('status')} == 'playing'",
    f"{N('turn')} == {D('starter')}",
    f"{N('turnAt')} == now",
    f"{N('owe')} == -1",
    OR(AND(f"{D('starter')} == 0", f"{N('b0')} == {D('base')} + {COUNTDOWN}", f"{N('b1')} == {D('base')}"),
       AND(f"{D('starter')} == 1", f"{N('b1')} == {D('base')} + {COUNTDOWN}", f"{N('b0')} == {D('base')}")),
    same_except("guest","guestName","status","turn","turnAt","b0","b1","owe"),
)

def move(p):
    q = 1 - p
    hp, hq, bp, bq = f"h{p}", f"h{q}", f"b{p}", f"b{q}"
    new_hand = N(hp)
    won = has_line(new_hand)
    full = f"({new_hand}.length + {D(hq)}.length == 9)"
    return AND(
        f"{D('status')} == 'playing'", f"{D('turn')} == {p}", f"auth.uid == {seat_uid(p)}",
        f"now <= {D('turnAt')} + {D(bp)} + {GRACE}",
        f"newData.child('last').isString()", f"{N('last')}.matches(/^[1-9]$/)",
        f"!{D('h0')}.contains({N('last')})", f"!{D('h1')}.contains({N('last')})",
        f"{N(hp)} == {D(hp)} + {N('last')}",
        f"{N('turnAt')} == now", f"{N('prevAt')} == {D('turnAt')}",
        f"{N('owe')} == {p}", f"{N('turn')} == {q}",
        OR(AND(f"{D('owe')} == -1", same(bq)),
           AND(f"{D('owe')} == {q}", f"{N(bq)} == {D(bq)} - ({D('turnAt')} - {D('prevAt')}) + {D('inc')}")),
        OR(AND(won, f"{N('status')} == 'over'", f"{N('winner')} == {p}", f"{N('reason')} == 'line'"),
           AND(f"!{won}", full, f"{N('status')} == 'over'", f"{N('winner')} == -1", f"{N('reason')} == 'draw'"),
           AND(f"!{won}", f"!{full}", f"{N('status')} == 'playing'", nulls("winner","reason"))),
        same_except(hp, bq, "last", "turnAt", "prevAt", "owe", "turn", "status", "winner", "reason"),
    )

def timeout(p):  # seat p ran out of time on their turn; either player may claim it
    return AND(
        f"{D('status')} == 'playing'", f"{D('turn')} == {p}", is_player,
        f"now > {D('turnAt')} + {D(f'b{p}')} + {GRACE}",
        f"{N('status')} == 'over'", f"{N('winner')} == {1 - p}", f"{N('reason')} == 'time'",
        same_except("status", "winner", "reason"),
    )

def resign(p):
    return AND(
        f"{D('status')} == 'playing'", f"auth.uid == {seat_uid(p)}",
        f"{N('status')} == 'over'", f"{N('winner')} == {1 - p}", f"{N('reason')} == 'resign'",
        same_except("status", "winner", "reason"),
    )

rematch = AND(
    f"{D('status')} == 'over'", is_player, f"{D('rematch')} == null",
    f"newData.child('rematch').isString()", f"{N('rematch')}.matches(/^[a-z0-9]{{8}}$/)",
    same_except("rematch"),
)

str_field = lambda n: {".validate": f"newData.isString() && newData.val().length <= {n}"}
num_field = {".validate": "newData.isNumber()"}
game_fields = {f: num_field for f in ["base","inc","starter","createdAt","turn","turnAt","prevAt","b0","b1","owe","winner"]}
game_fields.update({
    "host": str_field(128), "guest": str_field(128), "invitee": str_field(128),
    "hostName": str_field(20), "guestName": str_field(20),
    "status": str_field(10), "h0": str_field(9), "h1": str_field(9),
    "last": str_field(1), "reason": str_field(10), "rematch": str_field(8),
    "$other": {".validate": False},
})

rules = {
    "rules": {
        ".read": False,
        ".write": False,
        "games": {
            "$gid": {
                ".read": True,
                ".write": "auth != null",
                ".validate": AND("newData.exists()", f"$gid.matches(/^[a-z0-9]{{8}}$/)",
                                 OR(create, join, move(0), move(1), timeout(0), timeout(1),
                                    resign(0), resign(1), rematch)),
                **game_fields,
            }
        },
        # Private list of people you've played; each entry must point at a game you both played.
        "users": {
            "$uid": {
                ".read": "auth.uid == $uid",
                "opponents": {
                    "$opp": {
                        ".write": "auth.uid == $uid",
                        ".validate": AND(
                            "newData.hasChildren(['last', 'gameId'])",
                            f"{N('last')} == now",
                            OR(AND(f"root.child('games/' + {N('gameId')} + '/host').val() == $uid",
                                   f"root.child('games/' + {N('gameId')} + '/guest').val() == $opp"),
                               AND(f"root.child('games/' + {N('gameId')} + '/host').val() == $opp",
                                   f"root.child('games/' + {N('gameId')} + '/guest').val() == $uid")),
                        ),
                        "name": str_field(20),
                        "gameId": str_field(8),
                        "last": num_field,
                        "w": num_field, "d": num_field, "l": num_field,
                        "$other": {".validate": False},
                    }
                },
            }
        },
        # Online-now flag, readable by signed-in players.
        "status": {
            "$uid": {
                ".read": "auth != null",
                ".write": "auth.uid == $uid",
                ".validate": "newData.isBoolean()",
            }
        },
        # Challenges and rematch requests. Only to people you've played, only for a waiting game
        # you host that names them as invitee. Recipient or sender may delete (decline / cancel).
        "inbox": {
            "$to": {
                ".read": "auth.uid == $to",
                "$gid": {
                    ".read": "auth != null && (auth.uid == $to || (data.exists() && data.child('from').val() == auth.uid))",
                    ".write": "auth != null && (auth.uid == $to || data.child('from').val() == auth.uid || (!data.exists() && newData.child('from').val() == auth.uid))",
                    ".validate": AND(
                        f"{N('from')} == auth.uid",
                        "root.child('users/' + auth.uid + '/opponents/' + $to).exists()",
                        "root.child('games/' + $gid + '/host').val() == auth.uid",
                        "root.child('games/' + $gid + '/invitee').val() == $to",
                        "root.child('games/' + $gid + '/status').val() == 'waiting'",
                        f"{N('at')} == now",
                        OR(f"{N('kind')} == 'challenge'", f"{N('kind')} == 'rematch'"),
                    ),
                    "from": str_field(128),
                    "fromName": str_field(20),
                    "kind": str_field(10),
                    "base": num_field, "inc": num_field, "at": num_field,
                    "$other": {".validate": False},
                }
            }
        },
        # Web Push subscriptions. Readable by you and by people you've played (the /api/notify
        # function reads them with the sender's credentials); sending also needs our VAPID key.
        "push": {
            "$uid": {
                ".read": "auth.uid == $uid || root.child('users/' + $uid + '/opponents/' + auth.uid).exists()",
                "$sub": {
                    ".write": "auth.uid == $uid",
                    ".validate": AND("newData.hasChildren(['endpoint', 'p256dh', 'auth', 'at'])",
                                     "$sub.matches(/^[a-f0-9]{24}$/)", f"{N('at')} == now"),
                    "endpoint": {".validate": "newData.isString() && newData.val().beginsWith('https://') && newData.val().length <= 1000"},
                    "p256dh": str_field(200),
                    "auth": str_field(100),
                    "at": num_field,
                    "$other": {".validate": False},
                }
            }
        },
        "presence": {
            "$gid": {
                ".read": True,
                "$seat": {
                    ".write": "auth != null && (($seat == '0' && root.child('games/' + $gid + '/host').val() == auth.uid) || "
                              "($seat == '1' && root.child('games/' + $gid + '/guest').val() == auth.uid))",
                    ".validate": "newData.isBoolean()",
                }
            }
        },
    }
}

out = Path(__file__).resolve().parent.parent / "database.rules.json"
out.write_text(json.dumps(rules, indent=2) + "\n")
print(f"wrote {out} ({out.stat().st_size} bytes)")
