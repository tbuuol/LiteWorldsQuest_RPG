#!/usr/bin/env python3
"""Shops in Genesis (tbuuol 2026-11-08: "Jo mit tLTC"): a shop plot's owner puts things from the chest on the counter
at a price in tLTC; a buyer pays the price and the city's levy of 10 % ON TOP, to the city (an invoice of
tools/ltc_pay.py whose key is 'shop:<plot>:<offer>' and whose meta names the seller and the price); once the payment
is in a block, the seller is paid the whole price (to the L test address of their own key) and the game hands the
thing to the buyer (houseShopDeliver). The levy stays with the city. Table shop_sales; one round at a time.
"""
from __future__ import annotations

import json
import time

import deeds
import ltc_pay
import resale


def setup(db) -> None:
    db.execute("CREATE TABLE IF NOT EXISTS shop_sales (k TEXT PRIMARY KEY, buyer TEXT NOT NULL, btag TEXT, seller TEXT NOT NULL, "
               "price TEXT NOT NULL, paytx TEXT, state TEXT NOT NULL, payout TEXT, err TEXT, updated REAL NOT NULL)")


def paid(db, p: dict) -> None:
    setup(db)
    meta = p.get("meta") or {}
    with db:
        db.execute("INSERT OR IGNORE INTO shop_sales (k, buyer, btag, seller, price, paytx, state, updated) VALUES (?, ?, ?, ?, ?, ?, 'paid', ?)",
                   (p["plot"], p["addr"], p.get("tag") or "", meta.get("seller") or "", str(meta.get("price") or "0"), p.get("txid") or "", time.time()))


def step_at(path) -> list:
    """One round: [("deliver", key, buyer, btag)] for the game, once the seller is paid."""
    import sqlite3
    db = sqlite3.connect(str(path), timeout=30)
    tell = []
    try:
        setup(db)
        for k, buyer, btag, seller, price, paytx, state, payout_tx in db.execute(
                "SELECT k, buyer, btag, seller, price, paytx, state, payout FROM shop_sales WHERE state = 'paid'").fetchall():
            try:
                if int(ltc_pay.rpc("getrawtransaction", paytx, 1).get("confirmations") or 0) < 1:
                    continue
                if not payout_tx and seller and float(price) > 0:
                    payout_tx = resale.payout(resale._pay(), resale.ltc_test_twin(seller), price)
                    with db:
                        db.execute("UPDATE shop_sales SET payout = ?, updated = ? WHERE k = ?", (payout_tx, time.time(), k))
                    deeds.log("shop paid out", k, price, "to", seller, payout_tx)
                tell.append(("deliver", k, buyer, btag or ""))
            except Exception as e:   # noqa: BLE001 -- again next round
                with db:
                    db.execute("UPDATE shop_sales SET err = ?, updated = ? WHERE k = ?", (str(e)[:200], time.time(), k))
    finally:
        db.close()
    return tell


def delivered(db, k: str) -> None:
    with db:
        db.execute("UPDATE shop_sales SET state = 'done', updated = ? WHERE k = ?", (time.time(), k))
