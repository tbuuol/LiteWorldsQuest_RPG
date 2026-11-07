# A page may ask for coins on another chain the reader holds (`/r/send` `chain`)

**Why.** LiteWorldsQuest sells building plots in Genesis for Litecoin testnet. Every account already holds a key on each chain its arcade runs, and the Wallet can send L test, but `POST /r/send` always builds on the arcade's own chain. So a game cannot ask a player to pay in tLTC; today it has to show an address and an amount and watch the chain itself.

**What changes.**
- `POST /r/send` with `kind: "coins"` takes an optional `chain` (a network, e.g. `"ltctest"`). The question records it (`network`), plus the chain's coin name.
- `/account/pagesends` gives each question its `chain` and `coin`; the player's browser (`base.html` `pageSends`) builds the offer with `offerSend(..., chain)` on that chain and the card says e.g. `0.05 LTC TEST`. The wallet already holds keys for every chain, so nothing new is unlocked.
- The answer (`/account/pagesends/answer`) and `/r/send/<id>` check the txid on that chain's node (`_send_chain`: the account's chains, then the indexed ones). The answer carries `chain`.
- A `ref` is per chain, as the docs already said.
- Refused with a 400: `chain` on a token or an inscription; a chain this arcade does not run or has not synced (`_chain_asked`'s wording); another chain for the node's own wallet (the approvals queue stays on the arcade's chain).

**Tests.** `tests/test_send_ref.py`: three new tests (an L test question shown and answered on L test's node; only coins and only a chain this arcade runs; the node's own wallet on its own chain). `test_send_ref`, `test_approvals`, `test_public`, `test_creator_allowance`, `test_litecoin_testnet`, `test_operator_play`, `test_rpc_web`, `test_browser_approvals` and `test_page_autosign_browser` pass.

**Docs.** `arcade/web/docs/inscription-api.md`: the `chain` field and a paragraph "Coins on another chain".

🤖 Generated with [Claude Code](https://claude.com/claude-code)
