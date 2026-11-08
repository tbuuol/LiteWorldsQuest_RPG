#!/usr/bin/env python3
"""Plots sold on, player to player (tbuuol 2026-11-08: "mach den Weiterverkauf klar"), the city as escrow.

1. The owner offers the plot at a price (tLTC) at the town hall, and hands the deed to the registry: the publisher's
   address, the same that inscribed it (the arcade's wallet card, kind inscription).
2. The deed is there (this module sees its owner on the chain): the sale is open; the registry shows it.
3. A buyer pays the price plus the city's levy of 10 % ON TOP (tbuuol: never taken off the seller's price) -- the
   invoice of tools/ltc_pay.py, to the house's tLTC address.
4. Paid and confirmed: the seller is paid the whole price in tLTC (to the L test address of the seller's own key, the
   same hash as the P test address), then the deed is handed to the buyer, and the game makes the buyer the owner.
   The 10 % stay with the city.
A sale taken back before it is bought: the deed goes back to the seller. And always: whoever holds a deed on the
chain owns its plot (houseDeedOwners), however it got there.

The sales live in the house's database (table sales); jobs run one step at a time beside the house's loop.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import time
import urllib.request

import deeds
import ltc_pay

ROOT = pathlib.Path(__file__).resolve().parent.parent
NODE = "http://127.0.0.1:8420"
LEVY = 0.10
FEE = 0.0002          # tLTC for a payout


def escrow() -> str:
    cfg = json.loads((ROOT / "config.json").read_text())
    return cfg["creators"][1]          # the publisher key's address: it inscribes the deeds and keeps them for sale


def setup(db) -> None:
    db.execute("CREATE TABLE IF NOT EXISTS sales (plot TEXT PRIMARY KEY, seller TEXT NOT NULL, tag TEXT, price TEXT NOT NULL, "
               "deed TEXT NOT NULL, state TEXT NOT NULL, buyer TEXT, btag TEXT, paytx TEXT, payout TEXT, err TEXT, made REAL NOT NULL, updated REAL NOT NULL)")


def b58decode(s: str) -> bytes:
    n = 0
    for ch in s:
        n = n * 58 + ltc_pay.B58.index(ch)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    raw = b"\0" * (len(s) - len(s.lstrip("1"))) + raw
    body, check = raw[:-4], raw[-4:]
    if hashlib.sha256(hashlib.sha256(body).digest()).digest()[:4] != check:
        raise ValueError("bad address")
    return body


def ltc_test_twin(pep_address: str) -> str:
    """The L test address of the same key (an arcade account's keys are the same on every test chain)."""
    return ltc_pay.b58check(b"\x6f" + b58decode(pep_address)[1:])


def deed_owners() -> dict:
    """{deed inscription id: owner} for every deed the publisher inscribed."""
    req = urllib.request.Request(f"{NODE}/r/inscriptions?creator={escrow()}&limit=300")
    with urllib.request.urlopen(req, timeout=30) as r:
        rows = json.loads(r.read())
    return {p["id"]: p.get("owner") for p in rows if isinstance(p.get("json"), dict) and p["json"].get("lwq") == "deed"}


def payout(pay: "ltc_pay.Pay", to: str, amount: str) -> str:
    """Pay `amount` tLTC from the house's address to `to`; the change back to the house. Confirmed coins only."""
    rpc, me = ltc_pay.rpc, pay.key["address"]
    found = rpc("scantxoutset", "start", json.dumps([f"addr({me})"]))
    coins = sorted(found.get("unspents", []), key=lambda u: -u["amount"])
    want, got, ins = round(float(amount) * 1e8), 0, []
    for u in coins:
        ins.append(u); got += round(u["amount"] * 1e8)
        if got >= want + round(FEE * 1e8):
            break
    if got < want + round(FEE * 1e8):
        raise RuntimeError(f"the house holds {got / 1e8:.8f} tLTC confirmed, {amount} + fee wanted")
    outs = {to: f"{want / 1e8:.8f}"}
    change = got - want - round(FEE * 1e8)
    if change >= 10000:
        outs[me] = f"{change / 1e8:.8f}"
    raw = rpc("createrawtransaction", json.dumps([{"txid": u["txid"], "vout": u["vout"]} for u in ins]), json.dumps(outs))
    prev = json.dumps([{"txid": u["txid"], "vout": u["vout"], "scriptPubKey": u["scriptPubKey"], "amount": u["amount"]} for u in ins])
    signed = rpc("signrawtransactionwithkey", raw, json.dumps([pay.key["wif"]]), prev)
    if not signed.get("complete"):
        raise RuntimeError("could not sign the payout")
    return rpc("sendrawtransaction", signed["hex"])


def handle_asks(db, asks: list) -> None:
    """What owners asked at the town hall: sell (price, deed) or take back."""
    setup(db)
    now = time.time()
    for a in asks:
        plot = str(a["plot"])
        row = db.execute("SELECT state FROM sales WHERE plot = ?", (plot,)).fetchone()
        if a.get("x") == "sell" and (row is None or row[0] in ("done", "gone")):
            with db:
                db.execute("INSERT OR REPLACE INTO sales (plot, seller, tag, price, deed, state, made, updated) VALUES (?, ?, ?, ?, ?, 'escrow', ?, ?)",
                           (plot, a["addr"], a.get("tag") or "", a["price"], a["deed"], now, now))
        elif a.get("x") == "unsell" and row is not None:
            with db:
                if row[0] == "escrow":
                    db.execute("UPDATE sales SET state = 'gone', updated = ? WHERE plot = ?", (now, plot))
                elif row[0] == "open":
                    db.execute("UPDATE sales SET state = 'return', updated = ? WHERE plot = ?", (now, plot))


def listed(db) -> list:
    """the sales the game shows: [{plot, price, total, seller, tag, state}]"""
    setup(db)
    out = []
    for plot, seller, tag, price, state in db.execute("SELECT plot, seller, tag, price, state FROM sales WHERE state IN ('escrow', 'open', 'paid', 'return')"):
        total = f"{float(price) * (1 + LEVY):.8f}".rstrip("0").rstrip(".")
        out.append({"plot": plot, "price": price, "total": total, "seller": seller, "tag": tag, "state": state})
    return out


def paid(db, plot: str, buyer: str, btag: str, paytx: str) -> bool:
    """an invoice for an open sale was paid: True (the sale goes on here), False (not a sale: a first purchase)"""
    setup(db)
    row = db.execute("SELECT state FROM sales WHERE plot = ?", (plot,)).fetchone()
    if not row or row[0] != "open":
        return False
    with db:
        db.execute("UPDATE sales SET state = 'paid', buyer = ?, btag = ?, paytx = ?, updated = ? WHERE plot = ?", (buyer, btag, paytx, time.time(), plot))
    return True


def step_at(path, pay_key_path=None) -> list:
    """One round of the sales' jobs, on a connection of its own. Returns what the game must hear:
    [("owners", {deed: owner}), ("resold", plot, buyer, btag), ...]"""
    import sqlite3
    db = sqlite3.connect(str(path), timeout=30)
    tell = []
    try:
        setup(db)
        owners = deed_owners()
        tell.append(("owners", owners))
        esc, now = escrow(), time.time()
        for plot, seller, price, deed, state, buyer, btag, payout_tx in db.execute(
                "SELECT plot, seller, price, deed, state, buyer, btag, payout FROM sales WHERE state IN ('escrow', 'paid', 'return')").fetchall():
            def save(**kw):
                cols = ", ".join(f"{k} = ?" for k in kw)
                with db:
                    db.execute(f"UPDATE sales SET {cols}, updated = ? WHERE plot = ?", (*kw.values(), now, plot))
            if state == "escrow" and owners.get(deed) == esc:
                save(state="open"); deeds.log("sale open", plot, price)
            elif state == "paid":
                if not payout_tx:
                    try:
                        tx = payout(_pay(), ltc_test_twin(seller), price)
                        save(payout=tx); deeds.log("paid out", plot, price, "to", seller, tx)
                    except Exception as e:   # noqa: BLE001 -- not confirmed yet, most likely: again later
                        save(err=str(e)[:200])
                        continue
                code, out = deeds.run(["--send-nft", deed, buyer, "--intent", f"resale-{plot}-{buyer[-6:]}"], timeout=600)
                got = deeds.tail_json(out) if code == 0 else None
                if not got:
                    save(err=out[-200:]); continue
                save(state="done", err=None); deeds.log("deed", plot, "handed to", buyer)
                tell.append(("resold", plot, buyer, btag or ""))
            elif state == "return":
                code, out = deeds.run(["--send-nft", deed, seller, "--intent", f"return-{plot}-{int(now // 3600)}"], timeout=600)
                if code == 0 and deeds.tail_json(out):
                    save(state="gone"); deeds.log("deed", plot, "back to", seller)
                else:
                    save(err=out[-200:])
    finally:
        db.close()
    return tell


def _pay():
    """the house's key, without a database (payout needs only the key)"""
    p = ltc_pay.Pay.__new__(ltc_pay.Pay)
    p.key = json.loads(ltc_pay.KEY.read_text())
    return p


if __name__ == "__main__":
    import sqlite3
    db = sqlite3.connect(str(ROOT / ".publisher/beta-players.sqlite"))
    setup(db)
    for r in db.execute("SELECT plot, seller, price, state, buyer, payout, err FROM sales"):
        print(r)
    print("escrow", escrow(), "| twin of npa96KY2W5KgvDYzagnNBw4c55XorQGzTb ->", ltc_test_twin("npa96KY2W5KgvDYzagnNBw4c55XorQGzTb"))
