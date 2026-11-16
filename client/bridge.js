// Stablecoin bridge for BCH BLAZE (bundled separately into /bridge.js so invoice pages stay light).
import { binToHex, hexToBin, encodeTransaction, hashTransaction } from '@bitauth/libauth';
import { connect, chain, scan, lock, addressAt, RECEIVE, manager } from './bch-wallet.js';

import { ExchangeLab } from '@cashlab/cauldron';
import { SpendableCoinType, PayoutAmountRuleType, NATIVE_BCH_TOKEN_ID } from '@cashlab/common';

// ── Stablecoin bridge (BCH BLAZE «Stablecoin Bridge» bounty) ──────────────────────────────────────────────
// PUSD or MUSD ⇄ BCH on Cauldron (the BCH DEX), in one transaction that the wallet signs over WizardConnect. Selling PUSD
// can pay the BCH straight to another address (a NEAR Intents deposit address), so PUSD/MUSD → USDC on any chain is a
// single signature on the BCH side. Pool inputs unlock by contract; only the wallet's own inputs need its signature.


export const PUSD_CATEGORY = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';
export const MUSD_CATEGORY = 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366';
/** BCH dollar stablecoins the bridge handles (both CashTokens with 2 decimals, both traded on Cauldron). */
export const TOKENS = { PUSD: { symbol: 'PUSD', name: 'ParyonUSD', category: PUSD_CATEGORY }, MUSD: { symbol: 'MUSD', name: 'Moria USD', category: MUSD_CATEGORY } };
const tok = (t = 'PUSD') => { const x = TOKENS[t]; if (!x) throw new Error('Unknown stablecoin: ' + t); return x; };
const INDEXER = 'https://indexer.riften.net/cauldron';
const lab = new ExchangeLab();
// cashlab sizes the fee with real-looking signatures; this throwaway key only fills those bytes and its
// signatures are removed before the wallet signs. It never owns anything.
const SIZE_ONLY_KEY = new Uint8Array(32).fill(7);

const poolsCache = {};
/** Active `token`/BCH pools from the Cauldron indexer, as cashlab PoolV0 objects (cached 30 s per token). */
export async function pools(token = 'PUSD') {
  const cat = tok(token).category;
  const hit = poolsCache[cat];
  if (hit && Date.now() - hit.at < 30_000) return hit.list;
  const r = await fetch(`${INDEXER}/pool/active?token=${cat}`);
  if (!r.ok) throw new Error('Cauldron is not reachable right now.');
  const list = (await r.json()).active.map((p) => {
    const parameters = { withdraw_pubkey_hash: hexToBin(p.owner_pkh) };
    return { version: '0', parameters, outpoint: { index: p.tx_pos, txhash: hexToBin(p.txid) }, output: { locking_bytecode: lab.generatePoolV0LockingBytecode(parameters), token: { amount: BigInt(p.tokens), token_id: cat }, amount: BigInt(p.sats) } };
  });
  poolsCache[cat] = { at: Date.now(), list };
  return list;
}

/** How many sats `cents` of the token buy right now (sell side), or how many token cents `sats` buy (buy side). */
export async function quote(side, amount, token = 'PUSD') {
  const cat = tok(token).category;
  const p = await pools(token);
  const t = side === 'sell'
    ? lab.constructTradeBestRateForTargetSupply(cat, NATIVE_BCH_TOKEN_ID, BigInt(amount), p, 1n)
    : lab.constructTradeBestRateForTargetSupply(NATIVE_BCH_TOKEN_ID, cat, BigInt(amount), p, 1n);
  return { supply: String(t.summary.supply), demand: String(t.summary.demand), fee: String(t.summary.trade_fee), pools: t.entries.length };
}

const toCoin = (x) => ({
  type: SpendableCoinType.P2PKH, key: SIZE_ONLY_KEY,
  outpoint: { index: x.u.tx_pos, txhash: hexToBin(x.u.tx_hash) },
  output: { locking_bytecode: lock(x.address), amount: BigInt(x.u.value), ...(x.u.token_data ? { token: { amount: BigInt(x.u.token_data.amount), token_id: x.u.token_data.category } } : {}) },
});

/** Signs a cashlab trade with the wallet: pool inputs keep their contract unlock, wallet inputs are signed by it. */
async function signTrade(tx, picked, prompt) {
  const t = tx.libauth_generated_transaction;
  const mine = new Map(picked.map((x) => [`${x.u.tx_hash}:${x.u.tx_pos}`, x]));
  const inputs = t.inputs.map((i) => (mine.has(`${binToHex(i.outpointTransactionHash)}:${i.outpointIndex}`) ? { ...i, unlockingBytecode: new Uint8Array() } : i));
  const sourceOutputs = inputs.map((i, n) => {
    const o = tx.libauth_source_outputs[n];
    return {
      outpointTransactionHash: binToHex(i.outpointTransactionHash), outpointIndex: i.outpointIndex, unlockingBytecode: binToHex(i.unlockingBytecode), sequenceNumber: i.sequenceNumber,
      valueSatoshis: `<bigint: ${o.valueSatoshis}n>`, lockingBytecode: binToHex(o.lockingBytecode),
      ...(o.token ? { token: { category: binToHex(o.token.category), amount: `<bigint: ${o.token.amount}n>`, ...(o.token.nft ? { nft: { capability: o.token.nft.capability, commitment: binToHex(o.token.nft.commitment) } } : {}) } } : {}),
    };
  });
  const inputPaths = inputs.flatMap((i, n) => { const x = mine.get(`${binToHex(i.outpointTransactionHash)}:${i.outpointIndex}`); return x ? [[n, x.path, x.index]] : []; });
  const res = await manager().signTransaction({
    transaction: { transaction: binToHex(encodeTransaction({ ...t, inputs })), sourceOutputs, broadcast: true, userPrompt: prompt },
    inputPaths,
  });
  if (res.error) throw new Error(res.error);
  return res.signedTransaction;
}
/** The txid of a signed transaction (hex). */
export function txid(signed) {
  return hashTransaction(hexToBin(signed));
}

async function walletCoins(onQr, onStep) {
  await connect(onQr);
  onStep?.('scan');
  const c = await chain();
  try { return await scan(c); } finally { c.close(); }
}

const cents = (coins, cat) => coins.filter((x) => x.u.token_data?.category === cat && !x.u.token_data.nft).reduce((s, x) => s + Number(x.u.token_data.amount), 0);
/** The connected wallet's address and balances: { address, sats, pusd, musd } (stablecoins in cents). */
export async function balances(onQr) {
  const { coins } = await walletCoins(onQr);
  return {
    address: addressAt(RECEIVE, 0),
    sats: coins.filter((x) => !x.u.token_data).reduce((s, x) => s + x.u.value, 0),
    pusd: cents(coins, PUSD_CATEGORY),
    musd: cents(coins, MUSD_CATEGORY),
  };
}

/**
 * Sells `cents` of `token` (PUSD or MUSD) on Cauldron and pays the resulting BCH (minus the network fee) to `to`,
 * all in one transaction: { to, cents, token, memo, prompt, onQr, onStep } → { signed, sats } (sats = BCH delivered to `to`).
 */
export async function sellPusd({ to, cents, sats: exact, token = 'PUSD', memo, prompt, onQr, onStep }) {
  const { category: CAT, symbol } = tok(token);
  const { coins, change } = await walletCoins(onQr, onStep);
  const want = BigInt(cents);
  const tokenCoins = coins.filter((x) => x.u.token_data?.category === CAT && !x.u.token_data.nft).sort((a, b) => (BigInt(b.u.token_data.amount) > BigInt(a.u.token_data.amount) ? 1 : -1));
  const picked = [];
  let have = 0n;
  for (const x of tokenCoins) { if (have >= want) break; picked.push(x); have += BigInt(x.u.token_data.amount); }
  if (have < want) throw new Error(`Not enough ${symbol} in this wallet: needs ${(Number(want) / 100).toFixed(2)}.`);
  const fuel = coins.filter((x) => !x.u.token_data).sort((a, b) => b.u.value - a.u.value)[0];
  if (fuel) picked.push(fuel); // a little BCH for the fee and the token change output
  const trade = lab.constructTradeBestRateForTargetSupply(CAT, NATIVE_BCH_TOKEN_ID, want, await pools(token), 1n);
  // `exact`: the amount a NEAR Intents quote expects; otherwise leave room for the network fee (the rest returns as change)
  const sats = exact ? BigInt(exact) : trade.summary.demand - 3000n;
  if (sats > trade.summary.demand - 1500n) throw new Error(`The ${symbol} price moved. Get a new quote.`);
  const tx = lab.createTradeTx(trade.entries, picked.map(toCoin), [
    { type: PayoutAmountRuleType.FIXED, locking_bytecode: lock(to), amount: sats },
    { type: PayoutAmountRuleType.CHANGE, locking_bytecode: lock(change.address) },
  ], memo ? hexToBin(memo) : null, 1n);
  onStep?.('sign');
  const signed = await signTrade(tx, picked, prompt);
  return { signed, txid: txid(signed), sats: String(sats) };
}

/** Buys `token` (PUSD or MUSD) with `sats` BCH on Cauldron, paid to the wallet's own address: { sats, token, prompt, onQr, onStep } → { signed, cents }. */
export async function buyPusd({ sats, token = 'PUSD', prompt, onQr, onStep }) {
  const CAT = tok(token).category;
  const { coins, change } = await walletCoins(onQr, onStep);
  const spend = BigInt(sats);
  const picked = [];
  let have = 0n;
  for (const x of coins.filter((x) => !x.u.token_data).sort((a, b) => b.u.value - a.u.value)) { if (have >= spend + 5000n) break; picked.push(x); have += BigInt(x.u.value); }
  if (have < spend + 3000n) throw new Error(`Not enough BCH in this wallet: needs ${(Number(spend + 3000n) / 1e8).toFixed(8)} BCH.`);
  const trade = lab.constructTradeBestRateForTargetSupply(NATIVE_BCH_TOKEN_ID, CAT, spend, await pools(token), 1n);
  const me = addressAt(RECEIVE, 0);
  const tx = lab.createTradeTx(trade.entries, picked.map(toCoin), [
    { type: PayoutAmountRuleType.FIXED, locking_bytecode: lock(me), amount: -1n, token: { amount: trade.summary.demand, token_id: CAT } },
    { type: PayoutAmountRuleType.CHANGE, locking_bytecode: lock(change.address) },
  ], null, 1n);
  onStep?.('sign');
  const signed = await signTrade(tx, picked, prompt);
  return { signed, txid: txid(signed), cents: String(trade.summary.demand) };
}

export { sellPusd as sell, buyPusd as buy };

/** Pairs (if needed) and returns the wallet's first receive address, e.g. as the refund address of a bridge. */
export async function address(onQr) { await connect(onQr); return addressAt(RECEIVE, 0); }