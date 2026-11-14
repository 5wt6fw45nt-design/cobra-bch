// Browser side of "Pay with my wallet" for Bitcoin Cash, bundled by `npm run build:client` into src/bchwallet.gen.js
// and served at /bch-wallet.js. The client scans a WizardConnect QR with Paytaca, Cashonize or Zapit; this page
// builds the payment (BCH or PUSD to the freelancer + a "cobra <invoice>" OP_RETURN) and the wallet only signs it.
// Cobra never sees a key and never holds funds.

import { initiateDappRelay } from '@wizardconnect/core';
import { DappConnectionManager } from '@wizardconnect/dapp';
import { binToHex, hexToBin, encodeTransaction, hash160, encodeCashAddress, cashAddressToLockingBytecode } from '@bitauth/libauth';

const FULCRUM = ['wss://bch.imaginary.cash:50004', 'wss://fulcrum.greyh.at:50004', 'wss://bch.loping.net:50004'];
export const RECEIVE = 0;
const CHANGE = 1, DEPTH = 10, DUST = 546, TOKEN_DUST = 1000n;

/** One WebSocket session to the first Fulcrum server that answers. */
export async function chain() {
  for (const url of FULCRUM) {
    try {
      const ws = new WebSocket(url);
      let id = 0;
      const pending = new Map();
      await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; setTimeout(ko, 8000); });
      ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p[1](new Error(m.error.message)) : p[0](m.result); };
      const call = (method, ...params) => new Promise((ok, ko) => { const i = ++id; pending.set(i, [ok, ko]); ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, method, params })); });
      await call('server.version', 'cobra-pay', '1.5');
      return { call, close: () => ws.close() };
    } catch { /* next server */ }
  }
  throw new Error('Bitcoin Cash servers are not reachable right now. Try again in a minute.');
}

let mgr = null, relay = null;

/** Pairs with the wallet once per page. `onQr(text)` shows the pairing QR; resolves when the wallet is ready. */
export async function connect(onQr) {
  if (mgr?.isWalletDiscovered()) return mgr;
  mgr?.destroy(); relay?.cleanup();
  mgr = new DappConnectionManager('Cobra', `${location.origin}/favicon.ico`, { session: false });
  relay = initiateDappRelay((p) => mgr.updateConnection(p.client, p.status));
  mgr.attachRelay(relay);
  onQr(relay.qrUri || relay.uri, relay.uri);
  await new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error('No wallet connected. Scan the QR with Paytaca, Cashonize or Zapit.')), 10 * 60_000);
    mgr.once('walletready', () => { clearTimeout(t); ok(); });
    mgr.once('disconnect', () => { clearTimeout(t); ko(new Error('The wallet disconnected.')); });
  });
  return mgr;
}

export const addressAt = (child, index) => {
  const pub = mgr.getPubkey(child, BigInt(index));
  return pub ? encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkh', payload: hash160(pub) }).address : null;
};
export const lock = (address) => {
  const r = cashAddressToLockingBytecode(address);
  if (typeof r === 'string') throw new Error(r);
  return r.bytecode;
};

/** The wallet's coins (BCH and tokens) on its first receive/change addresses, and a fresh change address. */
export async function scan(c) {
  const addrs = [];
  for (const [child, path] of [[RECEIVE, 'receive'], [CHANGE, 'change']]) for (let i = 0; i < DEPTH; i++) { const a = addressAt(child, i); if (a) addrs.push({ path, index: i, address: a }); }
  if (!addrs.length) throw new Error('The wallet did not share its addresses.');
  const [utxos, hist] = await Promise.all([
    Promise.all(addrs.map((a) => c.call('blockchain.address.listunspent', a.address))),
    Promise.all(addrs.map((a) => c.call('blockchain.address.get_history', a.address))),
  ]);
  const coins = addrs.flatMap((a, i) => utxos[i].map((u) => ({ ...a, u })));
  const change = addrs.find((a, i) => a.path === 'change' && !hist[i].length) || addrs[0];
  return { coins, change };
}

/**
 * Pays an invoice. { to, sats, token: { category, amount } | null, memo (OP_RETURN hex), prompt, onQr, onStep }.
 * Returns the signed transaction hex (the wallet broadcasts it).
 */
export async function pay({ to, sats, token, memo, prompt, onQr, onStep = () => {} }) {
  await connect(onQr);
  onStep('scan');
  const c = await chain();
  let coins, change;
  try { ({ coins, change } = await scan(c)); } finally { c.close(); }

  const memoBin = hexToBin(memo);
  const outputs = [];
  const picked = [];
  let tokenIn = 0n;
  if (token) {
    // PUSD: take token coins of that category until they cover the amount
    const want = BigInt(token.amount);
    for (const x of coins.filter((x) => x.u.token_data?.category === token.category && !x.u.token_data.nft).sort((a, b) => (BigInt(b.u.token_data.amount) > BigInt(a.u.token_data.amount) ? 1 : -1))) {
      if (tokenIn >= want) break;
      picked.push(x); tokenIn += BigInt(x.u.token_data.amount);
    }
    if (tokenIn < want) throw new Error(`Not enough PUSD in this wallet: needs ${(Number(want) / 100).toFixed(2)}.`);
    outputs.push({ lockingBytecode: lock(to), valueSatoshis: TOKEN_DUST, token: { category: hexToBin(token.category), amount: want } });
  } else {
    if (sats < DUST) throw new Error('Amount below the dust limit.');
    outputs.push({ lockingBytecode: lock(to), valueSatoshis: BigInt(sats) });
  }
  outputs.push({ lockingBytecode: memoBin, valueSatoshis: 0n });
  if (token && tokenIn > BigInt(token.amount)) outputs.push({ lockingBytecode: lock(change.address), valueSatoshis: TOKEN_DUST, token: { category: hexToBin(token.category), amount: tokenIn - BigInt(token.amount) } });

  // BCH coins (no tokens) pay the amount, the token dust and the fee
  const need = outputs.reduce((s, o) => s + o.valueSatoshis, 0n);
  let bchIn = picked.reduce((s, x) => s + BigInt(x.u.value), 0n);
  const size = (ins) => 10 + ins * 148 + outputs.length * 34 + (token ? 2 * 45 : 0) + memoBin.length + 34 + 9;
  let fee = BigInt(size(picked.length));
  for (const x of coins.filter((x) => !x.u.token_data).sort((a, b) => b.u.value - a.u.value)) {
    if (bchIn >= need + fee) break;
    picked.push(x); bchIn += BigInt(x.u.value); fee = BigInt(size(picked.length));
  }
  if (bchIn < need + fee) throw new Error(`Not enough BCH in this wallet: needs ${(Number(need + fee) / 1e8).toFixed(8)} BCH.`);
  const rest = bchIn - need - fee;
  if (rest >= DUST) outputs.push({ lockingBytecode: lock(change.address), valueSatoshis: rest });

  const inputs = picked.map((x) => ({ outpointTransactionHash: hexToBin(x.u.tx_hash), outpointIndex: x.u.tx_pos, unlockingBytecode: new Uint8Array(), sequenceNumber: 0xffffffff }));
  const sourceOutputs = picked.map((x, i) => ({
    outpointTransactionHash: x.u.tx_hash, outpointIndex: x.u.tx_pos, unlockingBytecode: '', sequenceNumber: inputs[i].sequenceNumber,
    valueSatoshis: `<bigint: ${x.u.value}n>`, lockingBytecode: binToHex(lock(x.address)),
    ...(x.u.token_data ? { token: { category: x.u.token_data.category, amount: `<bigint: ${x.u.token_data.amount}n>` } } : {}),
  }));

  onStep('sign');
  const res = await mgr.signTransaction({
    transaction: { transaction: binToHex(encodeTransaction({ version: 2, locktime: 0, inputs, outputs })), sourceOutputs, broadcast: true, userPrompt: prompt },
    inputPaths: picked.map((x, i) => [i, x.path, x.index]),
  });
  if (res.error) throw new Error(res.error);
  return res.signedTransaction;
}

/** The live WizardConnect session (for the bridge bundle). */
export const manager = () => mgr;
