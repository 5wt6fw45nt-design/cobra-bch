# Cobra on XO

Cobra's invoice payment, migrated to an [XO](https://xo.cash) template.

In Cobra a freelancer bills a client from Telegram and the client pays straight to the freelancer's address. The payment carries an `OP_RETURN "cobra" "<invoice>"` memo so it can be matched to the invoice. Here the same flow is an XO template, so any XO wallet (for example [blaze.xo.cash](https://blaze.xo.cash)) can pay a Cobra invoice, and the paid output carries a follow-up action.

| | |
|---|---|
| Template | [`template/cobra-invoice.json`](template/cobra-invoice.json) (source: [`template/cobra-invoice.mjs`](template/cobra-invoice.mjs)) |
| CLI (freelancer side, XO engine in Node) | [`cobra-xo.mjs`](cobra-xo.mjs) |
| Mainnet invitation, paid from blaze.xo.cash | [`invitations/mainnet/invoice-paid-INV-0001.json`](invitations/mainnet/invoice-paid-INV-0001.json) |
| Mainnet follow-up (refund) | [`invitations/mainnet/refund-INV-0001.json`](invitations/mainnet/refund-INV-0001.json) |

## The template

**Roles:** `freelancer` and `client`.

**`issueInvoice`**, the start action, taken by the freelancer:
- The freelancer sets `invoiceSatoshis` and `invoiceNumber`. The engine generates a fresh `freelancerKey` for this invoice.
- The client joins the invitation and gives a `clientRefundLockingScript`, the address where a refund would go. Then they add their own coins, add change and sign.
- The transaction has two outputs:
  - Output 0 pays `invoiceSatoshis` to a P2PKH of `freelancerKey`.
  - Output 1 is the memo `OP_RETURN "cobra" <invoiceNumber>`.

**`refundInvoice`**, a follow-up action on the paid output:
- The paid output is a locking script with freelancer role state (`invoiceNumber`, `invoiceSatoshis`, `clientRefundLockingScript`). It offers `refundInvoice` to the freelancer.
- The refund spends that output and sends `refundSatoshis` to the client's refund address.
- It writes the memo `OP_RETURN "cobra-refund" <invoiceNumber>`.
- This is the "money back" step that Cobra did by hand before.

## Real transactions

**Mainnet, 16 Nov 2026.** The client side was paid from blaze.xo.cash. The freelancer side was this CLI.

| Step | Transaction |
|---|---|
| Invitation `e1d75eb94acdd7c22a4f349df5a494c8`, INV-0001, 3000 sats, paid as Client in blaze.xo.cash | [`b76cffd3cc92bd22d83e9618779b690a008442aec5cb62cc3452a07a673a0b57`](https://blockchair.com/bitcoin-cash/transaction/b76cffd3cc92bd22d83e9618779b690a008442aec5cb62cc3452a07a673a0b57) |
| Follow-up `refundInvoice`: 1900 sats back to the client's refund address | [`76474ee7c40f9a8144c76b94815491498941d9aeb2157989e9159b7b958860d4`](https://blockchair.com/bitcoin-cash/transaction/76474ee7c40f9a8144c76b94815491498941d9aeb2157989e9159b7b958860d4) |

**Chipnet.** Both sides were run with the CLI.

| Step | Transaction |
|---|---|
| TEST1 paid | `3a17b78ca58957c63a814e39d14cae4d365163630a611d4ae0e0d2ca64c6ff6b` |
| TEST2 paid | `d1d491abadde2a5316edb4036d93040045087a0c0adbc0dbb80d0b4d27829af6` |
| TEST2 refunded (follow-up) | `7bfb5c1dc4f3ad51a9aa8e8d698e5c09fdfb5488f8f7eea1fa0d64bdb367d5f4` |

## Reproduce it

```bash
cd xo
npm install
node cobra-xo.mjs address freelancer      # chipnet by default; XO_NETWORK=mainnet for mainnet
node cobra-xo.mjs issue 3000 INV-0002     # writes invitations/invoice-INV-0002.json
```

**Pay it in blaze.xo.cash.** blaze runs on mainnet, so use tiny amounts.
1. Import the template: Import Template, then "or paste JSON", and paste `template/cobra-invoice.json`.
2. Join the invitation: Join Invitation, paste `invitations/invoice-INV-0002.json`, choose the role **Client** and Accept.
3. In "Provide information":
   - Add your **Refund Address**.
   - Use **Add input** to pick a coin.
   - Use **Add change**. A new account has no change policy, so use **Manual** with your own locking bytecode.
4. Open **Sign** and press **Generate unlocking bytecode**.
5. Tick **Also broadcast**, then press **Create transaction**.
6. Use **Copy invitation** and save the result as `paid.json`.

**Or pay it with the CLI's test client:**

```bash
node cobra-xo.mjs pay invitations/invoice-INV-0002.json
```

**Then, on the freelancer side:**

```bash
XO_NETWORK=mainnet node cobra-xo.mjs watch paid.json        # the engine picks up the paid output
XO_NETWORK=mainnet node cobra-xo.mjs refund paid.json 1900   # follow-up action
```

The refund amount must leave change above dust. Keep it at about 1100 sats under the invoice amount.

## Notes from building it

- **Storage.** With engine `0.1.1-next.18029697917`, `storageType: 'sqlite'` throws "Not implemented yet". `indexeddb` with a `databasePath` works in Node.
- **Pinned versions.** `@xo-cash/utils` 0.0.11 cannot read invitations from this engine, which bundles utils 0.0.10 and state 0.0.5. Both are pinned here.
- **`locking_script` variables.** They must be passed as hex strings. A `Uint8Array` is accepted, but the serialized invitation comes out invalid.
- **Reserved coins.** A failed invitation keeps its inputs reserved until `archiveInvitation`.
- **Follow-up state.** Locking-script role state is not passed to the follow-up action automatically. The CLI reads it from the paid invitation and passes it explicitly.
- **Broadcasting.** In blaze.xo.cash, "Create transaction" without "Also broadcast" builds the result but does not broadcast it, and the invitation then shows RESULT CREATED. The mainnet payment above was rebuilt from the invitation's commits (same txid) and broadcast through Fulcrum.

MIT, like the rest of Cobra.
