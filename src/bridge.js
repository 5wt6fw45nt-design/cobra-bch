// Stablecoin bridge, server side (BCH BLAZE «Stablecoin Bridge» bounty): NEAR Intents 1Click quotes and status for
// BCH ⇄ USDC/USDT on other chains. The PUSD ⇄ BCH leg runs on Cauldron in the browser (client/bridge.js) and is
// signed by the user's wallet. Cobra never holds funds: 1Click deposit addresses refund to the user's own address.

import { isCashAddr, plainCashAddr } from './bch.js';
import { isNearAccount } from './intents.js';

export const BCH_1CLICK = 'nep141:bch.omft.near';
/** Stablecoins on other chains the bridge offers, in this order, if 1Click lists them. */
export const BRIDGE_CHAINS = [
  ['USDC', 'base'], ['USDC', 'arb'], ['USDC', 'eth'], ['USDC', 'sol'], ['USDC', 'pol'], ['USDC', 'bsc'], ['USDC', 'near'],
  ['USDT', 'eth'], ['USDT', 'tron'], ['USDT', 'sol'], ['USDT', 'bsc'], ['USDT', 'near'],
];
export const CHAIN_LABEL = { base: 'Base', arb: 'Arbitrum', eth: 'Ethereum', sol: 'Solana', pol: 'Polygon', bsc: 'BNB Chain', near: 'NEAR', tron: 'Tron' };

/** Rough format check of an address on a 1Click chain, so a typo fails before any money moves. */
export function isChainAddress(chain, a) {
  const s = String(a || '').trim();
  if (['base', 'arb', 'eth', 'pol', 'bsc'].includes(chain)) return /^0x[0-9a-fA-F]{40}$/.test(s);
  if (chain === 'sol') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
  if (chain === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s);
  if (chain === 'near') return isNearAccount(s);
  if (chain === 'bch') return isCashAddr(s);
  return false;
}

export class BridgeError extends Error {}

export function createBridge(intents) {
  /** [{ id: 'USDC-base', symbol, chain, label, assetId, decimals }] */
  async function stables() {
    const list = await intents.tokens();
    return BRIDGE_CHAINS.flatMap(([symbol, chain]) => {
      const t = list.find((x) => x.symbol === symbol && x.blockchain === chain);
      return t ? [{ id: `${symbol}-${chain}`, symbol, chain, label: `${symbol} · ${CHAIN_LABEL[chain] || chain}`, assetId: t.assetId, decimals: t.decimals }] : [];
    });
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
        deadline: Date.now() + 30 * 60_000,
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
      return { status: st.status, amountOut: d.amountOutFormatted || null, txOut: d.destinationChainTxHashes?.[0]?.explorerUrl || null, txIn: d.originChainTxHashes?.[0]?.explorerUrl || null };
    },
  };
}
