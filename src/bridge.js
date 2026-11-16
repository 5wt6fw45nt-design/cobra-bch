// Stablecoin bridge, server side (BCH BLAZE «Stablecoin Bridge» bounty): NEAR Intents 1Click quotes and status for
// BCH ⇄ USDC/USDT on other chains. The PUSD ⇄ BCH leg runs on Cauldron in the browser (client/bridge.js) and is
// signed by the user's wallet. Cobra never holds funds: 1Click deposit addresses refund to the user's own address.

import { isCashAddr, plainCashAddr } from './bch.js';
import { isNearAccount } from './intents.js';

export const BCH_1CLICK = 'nep141:bch.omft.near';
/** Stablecoins on other chains the bridge offers, in this order, if 1Click lists them. */
export const BRIDGE_CHAINS = [
  ['USDC', 'base'], ['USDC', 'arb'], ['USDC', 'eth'], ['USDC', 'sol'], ['USDC', 'pol'], ['USDC', 'bsc'], ['USDC', 'near'],
  ['USDC', 'op'], ['USDC', 'avax'], ['USDC', 'gnosis'],
  ['USDT', 'eth'], ['USDT', 'tron'], ['USDT', 'sol'], ['USDT', 'bsc'], ['USDT', 'near'], ['USDT', 'pol'], ['USDT', 'arb'],
];
/** Other assets NEAR Intents carries: anything here can come in as BCH (and from there PUSD/MUSD), or go out. */
export const BRIDGE_COINS = [
  ['BTC', 'btc'], ['ETH', 'eth'], ['ETH', 'base'], ['ETH', 'arb'], ['SOL', 'sol'], ['ZEC', 'zec'], ['LTC', 'ltc'],
  ['DOGE', 'doge'], ['XRP', 'xrp'], ['BNB', 'bsc'], ['TRX', 'tron'],
];
export const CHAIN_LABEL = { base: 'Base', arb: 'Arbitrum', eth: 'Ethereum', sol: 'Solana', pol: 'Polygon', bsc: 'BNB Chain', near: 'NEAR', tron: 'Tron',
  op: 'Optimism', avax: 'Avalanche', gnosis: 'Gnosis', btc: 'Bitcoin', zec: 'Zcash', ltc: 'Litecoin', doge: 'Dogecoin', xrp: 'XRP Ledger' };
/** Block explorer transaction URL prefix per chain (the delivery link shown once a bridge settles). */
export const EXPLORER_TX = { base: 'https://basescan.org/tx/', arb: 'https://arbiscan.io/tx/', eth: 'https://etherscan.io/tx/', sol: 'https://solscan.io/tx/',
  pol: 'https://polygonscan.com/tx/', bsc: 'https://bscscan.com/tx/', near: 'https://nearblocks.io/txns/', tron: 'https://tronscan.org/#/transaction/',
  op: 'https://optimistic.etherscan.io/tx/', avax: 'https://snowtrace.io/tx/', gnosis: 'https://gnosisscan.io/tx/', btc: 'https://mempool.space/tx/',
  zec: 'https://blockchair.com/zcash/transaction/', ltc: 'https://blockchair.com/litecoin/transaction/', doge: 'https://blockchair.com/dogecoin/transaction/',
  xrp: 'https://xrpscan.com/tx/', bch: 'https://blockchair.com/bitcoin-cash/transaction/' };

/** Rough format check of an address on a 1Click chain, so a typo fails before any money moves. */
export function isChainAddress(chain, a) {
  const s = String(a || '').trim();
  if (['base', 'arb', 'eth', 'pol', 'bsc', 'op', 'avax', 'gnosis'].includes(chain)) return /^0x[0-9a-fA-F]{40}$/.test(s);
  if (chain === 'btc') return /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(s);
  if (chain === 'ltc') return /^(ltc1[02-9ac-hj-np-z]{11,71}|[LM3][1-9A-HJ-NP-Za-km-z]{26,33})$/.test(s);
  if (chain === 'doge') return /^[DA9][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s);
  if (chain === 'zec') return /^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(s);
  if (chain === 'xrp') return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(s);
  if (chain === 'sol') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
  if (chain === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s);
  if (chain === 'near') return isNearAccount(s);
  if (chain === 'bch') return isCashAddr(s);
  return false;
}

export class BridgeError extends Error {}

export function createBridge(intents) {
  /** [{ id: 'USDC-base', symbol, chain, label, assetId, decimals, kind: 'stable'|'coin', price, explorer }] */
  async function stables() {
    const list = await intents.tokens();
    const take = (pairs, kind) => pairs.flatMap(([symbol, chain]) => {
      const t = list.find((x) => x.symbol === symbol && x.blockchain === chain);
      return t ? [{ id: `${symbol}-${chain}`, symbol, chain, label: `${symbol} · ${CHAIN_LABEL[chain] || chain}`, assetId: t.assetId, decimals: t.decimals,
        kind, price: Number(t.price) || (kind === 'stable' ? 1 : 0), explorer: EXPLORER_TX[chain] || null }] : [];
    });
    return [...take(BRIDGE_CHAINS, 'stable'), ...take(BRIDGE_COINS, 'coin')];
  }
  const pick = async (id) => {
    const s = (await stables()).find((x) => x.id === id);
    if (!s) throw new BridgeError('unknown stablecoin');
    return s;
  };

  return {
    stables,

    /**
     * A real 1Click quote with a deposit address. direction 'out': exactly `amount` sats of BCH (from the PUSD sale)
     * become the stablecoin at `to`; refunds go to the BCH address `refund`. direction 'in': `amount` base units of the
     * stablecoin become BCH at the BCH address `to`; refunds go to `refund` on the stablecoin's chain.
     */
    async quote({ direction, stable, amount, to, refund, dry = false }) {
      const s = await pick(stable);
      const units = String(amount || '').trim();
      if (!/^[1-9][0-9]{0,15}$/.test(units)) throw new BridgeError('amount');
      const out = direction === 'out';
      if (!isChainAddress(out ? s.chain : 'bch', to)) throw new BridgeError('to');
      if (!isChainAddress(out ? 'bch' : s.chain, refund)) throw new BridgeError('refund');
      const q = await intents.swap({
        dry,
        originAsset: out ? BCH_1CLICK : s.assetId, destinationAsset: out ? s.assetId : BCH_1CLICK, amount: units,
        recipient: out ? String(to).trim() : plainCashAddr(to), refundTo: out ? plainCashAddr(refund) : String(refund).trim(),
        // BCH deposits count only once mined, and a BCH block can take well over 30 min: a short deadline gets the
        // swap refunded as QUOTE_EXPIRED (happened on 16 Nov). Give BCH-side deposits 3 hours.
        deadline: Date.now() + (out ? 180 : 60) * 60_000,
      });
      return {
        depositAddress: q.depositAddress || null, depositMemo: q.depositMemo || null, deadline: q.deadline,
        amountIn: q.amountInFormatted, amountOut: q.amountOutFormatted, amountOutUnits: q.amountOut, minAmountOut: q.minAmountOut,
        timeEstimate: q.timeEstimate, symbolIn: out ? 'BCH' : s.symbol, symbolOut: out ? s.symbol : 'BCH', chain: s.chain,
      };
    },

    /** 1Click status of a bridge deposit: { status, txIn, txOut } */
    async status(depositAddress) {
      const st = await intents.status(depositAddress);
      const d = st.swapDetails || {};
      const hash = (x) => x?.[0]?.hash || null, url = (x) => x?.[0]?.explorerUrl || null;
      return { status: st.status, amountOut: d.amountOutFormatted || null, txOut: url(d.destinationChainTxHashes), txOutHash: hash(d.destinationChainTxHashes),
        txIn: url(d.originChainTxHashes), txInHash: hash(d.originChainTxHashes), refundReason: d.refundReason || null };
    },
  };
}
