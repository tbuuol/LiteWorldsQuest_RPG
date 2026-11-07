/* LiteWorldsQuest wallet module: who is playing, what they keep, and asking them to pay. Everything goes through
   the arcade's own doors (arcade/web/docs/inscription-api.md), so the page never sees a key:
     const w = await wallet.who()     -> {ok, tag, address, addresses, network, mainnet, coins, ticker, tokens} or
                                         {ok: false, why}  (403 when the player keeps the wallet private: still playable)
     const s = await wallet.store()   -> {get(key, fallback), set(key, value), remembered}   values are JSON; the
                                         arcade keeps them per inscription and wallet (arcade.storage); without a
                                         viewer they live in memory for this visit only
     const p = wallet.pay({amount, to, label, note}, onStatus)
                                      -> Promise<{status: 'sent'|'denied'|'failed'|'expired', txid?, error?}>
                                         files POST /r/send (kind coins) and polls /r/send/<id>; the player approves
                                         or refuses in the wallet, outside the game's sandbox. */
(function (G) {
  'use strict';
  const getJSON = async (url, init) => {
    const r = await fetch(url, Object.assign({ cache: 'no-store' }, init || {}));
    let j = null; try { j = await r.json(); } catch (e) { j = null; }
    return { status: r.status, ok: r.ok, j: j || {} };
  };
  const sleep = ms => new Promise(res => setTimeout(res, ms));

  const wallet = {
    api: 1,
    async who() {
      try {
        const { status, ok, j } = await getJSON('/r/wallet');
        if (!ok) return { ok: false, why: j.error || (status === 403 ? 'this wallet keeps who is playing private' : 'HTTP ' + status) };
        const addresses = Array.isArray(j.addresses) ? j.addresses : [];
        return { ok: true, tag: j.tag || '', address: addresses[0] || null, addresses, network: j.network || '',
                 mainnet: !!j.mainnet, coins: j.coin ? Number(j.coin.spendable || 0) : 0,
                 ticker: (j.coin && j.coin.ticker) || '', tokens: Array.isArray(j.tokens) ? j.tokens : [] };
      } catch (e) { return { ok: false, why: 'no wallet is answering' }; }
    },

    async store() {
      const S = G.arcade && G.arcade.storage;
      let shelf = null;
      if (S && S.ready) {
        try { shelf = await Promise.race([S.ready, sleep(5500).then(() => { throw new Error('no viewer'); })]); }
        catch (e) { shelf = null; }
      }
      const mem = {};
      return {
        remembered: !!shelf,
        get(key, fallback) {
          const raw = shelf ? shelf.getItem(key) : (key in mem ? mem[key] : null);
          if (raw == null) return fallback;
          try { return JSON.parse(raw); } catch (e) { return fallback; }
        },
        set(key, value) {
          const raw = JSON.stringify(value);
          if (!shelf) { mem[key] = raw; return Promise.resolve(true); }
          return shelf.setItem(key, raw).then(() => true, e => { console.warn('LWQ: not saved', e && e.message); return false; });
        }
      };
    },

    async pay(ask, onStatus) {
      const say = s => { try { if (onStatus) onStatus(s); } catch (e) { /* the game's problem */ } };
      const body = { kind: 'coins', to: ask.to, amount: String(ask.amount), label: ask.label || 'LiteWorldsQuest',
                     note: ask.note || '' };
      /* coins on another chain the player holds (ask.chain, e.g. 'ltctest'; the arcade change of 2026-11-07), and a
         ref so a lost reply is never paid twice */
      if (ask.chain) body.chain = ask.chain;
      if (ask.ref) body.ref = String(ask.ref).slice(0, 64);
      let filed;
      try {
        filed = await getJSON('/r/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch (e) { return { status: 'failed', error: 'no wallet is answering' }; }
      if (!filed.ok || !filed.j.id) return { status: 'failed', error: filed.j.error || 'refused' };
      if (ask.chain && filed.j.chain == null) return { status: 'failed', error: 'this arcade cannot pay in that coin from the wallet yet' };   /* an arcade before the change */
      say('pending');
      const until = Date.now() + 10 * 60 * 1000;   /* the arcade expires a request after an hour; a game stops asking sooner */
      while (Date.now() < until) {
        await sleep(1500);
        let got; try { got = await getJSON('/r/send/' + encodeURIComponent(filed.j.id)); } catch (e) { continue; }
        const st = got.j.status;
        if (st && st !== 'pending') return { status: st, txid: got.j.txid || null, error: got.j.error || null };
      }
      return { status: 'expired' };
    }
  };
  if (G.LWQ && G.LWQ.define) G.LWQ.define('wallet', { api: 1, v: 2 }, () => wallet);
})(typeof globalThis !== 'undefined' ? globalThis : this);
