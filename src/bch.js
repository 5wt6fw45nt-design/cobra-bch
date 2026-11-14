// Direct Bitcoin Cash payments (BCH BLAZE 2026): the client pays the freelancer's own BCH address, in BCH or in
// PUSD (ParyonUSD, a fungible CashToken stablecoin), and Cobra watches the chain through public Fulcrum servers.
// No keys, no custody: the payment page builds the transaction and the client's wallet (WizardConnect) signs it.

export const BCH_ASSET = 'bch:native'; // our own ids for "pay BCH directly" / "pay PUSD directly"
export const PUSD_ASSET = 'bch:pusd';
// ParyonUSD: fungible CashToken, 2 decimals (1 unit = 1 cent). Category checked on chain: its pre-genesis
// transaction's outputs carry the "mainnet-v1.paryonusd.com" OP_RETURN.
export const PUSD = { category: '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544', decimals: 2 };
export const MEMO_TAG = 'cobra';
export const TOKEN_DUST = 1000; // sats that travel with a token output
const FULCRUM = ['wss://bch.imaginary.cash:50004', 'wss://fulcrum.greyh.at:50004', 'wss://bch.loping.net:50004'];
export const txUrl = (txid) => `https://blockchair.com/bitcoin-cash/transaction/${txid}`;

// ── CashAddr (BCH address format), enough to normalise addresses and build their locking scripts ──
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];

function polymod(values) {
  let c = 1n;
  for (const d of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= GEN[i];
  }
  return c ^ 1n;
}

const prefixData = (prefix) => [...prefix].map((ch) => ch.charCodeAt(0) & 31).concat(0);

function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0;
  const out = [], max = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v; bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & max); }
  }
  if (pad && bits) out.push((acc << (to - bits)) & max);
  else if (!pad && (bits >= from || ((acc << (to - bits)) & max))) return null;
  return out;
}

/** 'bitcoincash:z…' → { type: 'p2pkh'|'p2sh', tokens: bool, hash: Uint8Array } or null if invalid. */
export function decodeCashAddr(address) {
  const s = String(address || '').trim().toLowerCase();
  const [prefix, payload] = s.includes(':') ? s.split(':') : ['bitcoincash', s];
  if (prefix !== 'bitcoincash' || !payload || ![...payload].every((ch) => CHARSET.includes(ch))) return null;
  const data = [...payload].map((ch) => CHARSET.indexOf(ch));
  if (polymod([...prefixData(prefix), ...data]) !== 0n) return null;
  const bytes = convertBits(data.slice(0, -8), 5, 8, false);
  if (!bytes) return null;
  const version = bytes[0], hash = Uint8Array.from(bytes.slice(1));
  const kind = (version >> 3) & 0xf; // 0 p2pkh, 1 p2sh, 2 p2pkh with tokens, 3 p2sh with tokens
  if (kind > 3 || (hash.length !== 20 && hash.length !== 32)) return null;
  return { type: kind % 2 ? 'p2sh' : 'p2pkh', tokens: kind >= 2, hash };
}

/** Builds a cashaddr; `tokens` gives the z…/r… form that token-aware wallets show. */
export function encodeCashAddr({ type, tokens = false, hash }) {
  const kind = (type === 'p2sh' ? 1 : 0) + (tokens ? 2 : 0);
  const sizeBits = { 20: 0, 24: 1, 28: 2, 32: 3, 40: 4, 48: 5, 56: 6, 64: 7 }[hash.length];
  const data = convertBits([(kind << 3) | sizeBits, ...hash], 8, 5, true);
  const mod = polymod([...prefixData('bitcoincash'), ...data, 0, 0, 0, 0, 0, 0, 0, 0]);
  const check = Array.from({ length: 8 }, (_, i) => Number((mod >> BigInt(5 * (7 - i))) & 31n));
  return `bitcoincash:${[...data, ...check].map((d) => CHARSET[d]).join('')}`;
}

export const isCashAddr = (a) => Boolean(decodeCashAddr(a));
/** The plain (q…/p…) form: what exchanges and NEAR Intents expect. */
export const plainCashAddr = (a) => { const d = decodeCashAddr(a); return d ? encodeCashAddr({ ...d, tokens: false }) : null; };
/** The token-aware (z…/r…) form, to show next to a PUSD payment. */
export const tokenCashAddr = (a) => { const d = decodeCashAddr(a); return d ? encodeCashAddr({ ...d, tokens: true }) : null; };

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
/** Locking script of an address, as hex: what Fulcrum shows in vout[].scriptPubKey.hex. */
export function lockingHex(address) {
  const d = decodeCashAddr(address);
  if (!d) throw new Error('invalid BCH address');
  if (d.type === 'p2pkh') return `76a914${hex(d.hash)}88ac`;
  return d.hash.length === 32 ? `aa20${hex(d.hash)}87` : `a914${hex(d.hash)}87`;
}

// ── Amounts and the invoice tag ──
/**
 * Exact sats for an invoice: the price, rounded up to 1000 sats, plus the invoice id modulo 1000. The last three
 * digits identify the invoice, so a payment from any wallet (scanning the QR) is matched even without a memo.
 */
export const taggedSats = (sats, invoiceId) => Math.ceil(Number(sats) / 1000) * 1000 + (Number(invoiceId) % 1000);
/** 123456 sats → "0.00123456" */
export const formatBch = (sats) => (Number(sats) / 1e8).toFixed(8);
export const formatPusd = (cents) => (Number(cents) / 100).toFixed(2);

/** OP_RETURN "cobra" "<invoice id>": tells the freelancer's history which invoice a transaction pays. */
export function memoHex(invoiceId) {
  const push = (s) => { const b = new TextEncoder().encode(s); return b.length.toString(16).padStart(2, '0') + hex(b); };
  return `6a${push(MEMO_TAG)}${push(String(invoiceId))}`;
}

/** Reads a "cobra <id>" memo back from an output script, or null. */
export function readMemo(scriptHex) {
  const h = String(scriptHex || '');
  if (!h.startsWith('6a')) return null;
  const parts = [];
  for (let i = 2; i < h.length;) {
    const n = parseInt(h.slice(i, i + 2), 16);
    if (!(n >= 1 && n <= 75)) return null;
    parts.push(h.slice(i + 2, i + 2 + n * 2)); i += 2 + n * 2;
  }
  const text = parts.map((p) => new TextDecoder().decode(Uint8Array.from(p.match(/../g) || [], (b) => parseInt(b, 16))));
  return text[0] === MEMO_TAG && text[1] ? text[1] : null;
}

/** BIP21 link for wallets that scan a QR: address and exact amount filled in. */
export const bip21 = (address, sats, label) => `${plainCashAddr(address)}?amount=${formatBch(sats)}${label ? `&message=${encodeURIComponent(label)}` : ''}`;

/**
 * Does this verbose transaction pay the watch? A BCH payment matches by its tagged amount, or by a "cobra <id>" memo
 * with at least the untagged price. A PUSD payment matches PUSD tokens to the address: at least the price with the
 * memo, or the exact price without it.
 */
export function matches(tx, w) {
  const memo = tx.vout.map((o) => readMemo(o.scriptPubKey?.hex)).find(Boolean);
  const ours = memo === String(w.invoiceId);
  const outs = tx.vout.filter((o) => o.scriptPubKey?.hex === w.script);
  if (w.kind === 'pusd') {
    const units = outs.reduce((s, o) => s + (o.tokenData?.category === PUSD.category ? BigInt(o.tokenData.amount || 0) : 0n), 0n);
    return ours ? units >= BigInt(w.cents) : units === BigInt(w.cents);
  }
  const sats = outs.reduce((s, o) => s + Math.round(Number(o.value) * 1e8), 0);
  return sats === w.sats || (ours && sats >= w.minSats);
}

// ── Fulcrum (Electrum protocol over WebSocket) ──
function fulcrumSession(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const timer = setTimeout(() => { ws.close(); reject(new Error(`${url}: timeout`)); }, timeoutMs);
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data));
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message || 'fulcrum error')) : p.resolve(msg.result);
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`${url}: unreachable`)); });
    ws.addEventListener('open', () => {
      const call = (method, ...params) => new Promise((ok, ko) => { const i = ++id; pending.set(i, { resolve: ok, reject: ko }); ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, method, params })); });
      resolve({ call, close: () => { clearTimeout(timer); ws.close(); } });
    });
  });
}

/**
 * Chain access. `connect` opens a session ({ call, close }); tests pass a fake one.
 * Every method opens one session, tries the next server if one is down, and closes it.
 */
export function createBch({ servers = FULCRUM, connect = fulcrumSession, timeoutMs = 12_000 } = {}) {
  async function withChain(fn) {
    let last;
    for (const url of servers) {
      let s;
      try {
        s = await connect(url, timeoutMs);
        await s.call('server.version', 'cobra', '1.5');
        return await fn(s);
      } catch (e) { last = e; } finally { s?.close(); }
    }
    throw last || new Error('no BCH server');
  }

  return {
    tip: () => withChain(async (s) => (await s.call('blockchain.headers.get_tip')).height),

    /**
     * Looks through the address history (and mempool) from `fromHeight` for a transaction that pays the watch.
     * Returns { txid, confirmed } or null. A payment seen in the mempool counts: BCH merchants accept 0-conf.
     */
    findPayment: (w) => withChain(async (s) => {
      const history = await s.call('blockchain.address.get_history', plainCashAddr(w.to));
      const recent = history.filter((h) => h.height <= 0 || h.height >= w.fromHeight - 1).slice(-25).reverse();
      for (const h of recent) {
        const tx = await s.call('blockchain.transaction.get', h.tx_hash, true);
        if (matches(tx, w)) return { txid: h.tx_hash, confirmed: h.height > 0 };
      }
      return null;
    }),
  };
}
