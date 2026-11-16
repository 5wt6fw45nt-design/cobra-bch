import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { d1Shim } from '../scripts/d1-shim.js';
import { createBot } from '../src/bot.js';
import { loadConfig } from '../src/config.js';
import { createIntents, isNearAccount, isPayoutAddress, normalizePayoutAddress, PAYOUTS, USDC } from '../src/intents.js';
import { createPayments, PayError } from '../src/payments.js';
import { budgetedAi, cleanEmail, normalizeDraft } from '../src/ai.js';
import { verifyInitData, toCsv, toRow } from '../src/webapp.js';
import worker from '../src/worker.js';
import { createMezo, formatUnits, taggedAmount, transferData } from '../src/mezo.js';
import { createConcordium, formatCcd, taggedCcd, parsePaymentHeader } from '../src/concordium.js';
import { createLightning, lnurlpUrl, bolt11Msat } from '../src/lightning.js';
import { inspectToken, payWithToken } from '../src/cashu.js';

const T0 = Date.UTC(2026, 10, 3, 10, 0); // 3 Nov 2026
const MIN = 60_000;

// --- AI helpers ---

test('spoken emails become real emails', () => {
  assert.equal(cleanEmail('marta arroba gmail punto com'), 'marta@gmail.com');
  assert.equal(cleanEmail('John at Example dot co dot uk'), 'john@example.co.uk');
  assert.equal(cleanEmail('no tengo su correo'), null);
});

test('drafts are normalized: cents, qty, currency (EUR/USD only), due date', () => {
  const ctx = { currency: 'EUR', today: '2026-11-03' };
  const d = normalizeDraft({ client_name: 'Marta <b>', items: [{ name: 'Logo', amount: '350', qty: 1 }, { name: 'Hours', amount: 40, qty: '2' }, { name: 'Free', amount: 0 }], currency: 'usd', due_days: 15 }, ctx);
  assert.deepEqual(d, {
    client_name: 'Marta b', client_email: null,
    items: [{ name: 'Logo', cents: 35000, qty: 1 }, { name: 'Hours', cents: 4000, qty: 2 }],
    currency: 'USD', due_date: '2026-11-18', note: null,
  });
  assert.equal(normalizeDraft({ items: [{ amount: 9 }], currency: 'GBP' }, ctx).currency, 'EUR');
});

// --- NEAR Intents client ---

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: String(url), path: u.pathname, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const h = routes[`${init.method} ${u.pathname}`] ?? routes[u.pathname];
    if (!h) return new Response('{"message":"not found"}', { status: 404 });
    const out = typeof h === 'function' ? h(calls.at(-1)) : h;
    return out instanceof Response ? out : Response.json(out);
  };
  return { fn, calls };
}

const TOKENS = [
  { assetId: USDC, symbol: 'USDC', blockchain: 'near', decimals: 6, price: 1 },
  { assetId: 'nep141:tron-usdt.omft.near', symbol: 'USDT', blockchain: 'tron', decimals: 6, price: 1 },
  { assetId: 'nep141:zec.omft.near', symbol: 'ZEC', blockchain: 'zec', decimals: 8, price: 1155 },
  { assetId: 'nep141:gnosis-eure.omft.near', symbol: 'EURe', blockchain: 'gnosis', decimals: 18, price: 1.12 },
  { assetId: 'nep141:weird.near', symbol: 'MEME', blockchain: 'near', decimals: 18, price: 0.01 },
  { assetId: 'nep141:bch.omft.near', symbol: 'BCH', blockchain: 'bch', decimals: 8, price: 280 },
];

test('1Click: curated pay options, EUR via the live EURe price, EXACT_OUTPUT quotes into USDC on NEAR', async () => {
  const { fn, calls } = fakeFetch({
    'GET /v0/tokens': TOKENS,
    'POST /v0/quote': (c) => ({ quote: { depositAddress: 'TDeposit1', amountInFormatted: '392.4', deadline: '2026-11-03T11:00:00.000Z' }, signature: 'ed25519:sig', correlationId: 'c1', quoteRequest: c.body }),
    'GET /v0/status': { status: 'PROCESSING', swapDetails: {} },
  });
  const it = createIntents({ base: 'https://1click.test', apiKey: 'KEY', rpc: 'https://rpc.test' }, fn);
  const opts = await it.payOptions();
  assert.deepEqual(opts.map((o) => `${o.symbol}/${o.chain}`), ['USDC/near', 'USDT/tron', 'ZEC/zec', 'BCH/bch'], 'only the curated list, in order');
  assert.equal(opts[1].chainName, 'Tron');
  assert.equal(await it.payoutUnits(35000, 'USD'), '350000000');
  assert.equal(await it.payoutUnits(35000, 'EUR'), '392000000');
  assert.equal(await it.payoutUnits(35000, 'EUR', 'arb'), '392000000');
  assert.equal(await it.payoutUnits(28000, 'USD', 'bch'), '100000000', '280 $ at 280 $/BCH = 1 BCH');
  assert.equal(calls.filter((c) => c.path === '/v0/tokens').length, 1, 'token list cached');

  const q = await it.quote({ originAsset: 'nep141:tron-usdt.omft.near', symbol: 'USDT', amount: '392000000', recipient: 'marta.near', refundTo: 'TRefund', deadline: Date.parse('2026-11-03T11:00:00Z') });
  assert.equal(q.depositAddress, 'TDeposit1');
  assert.equal(q.signature, 'ed25519:sig');
  const body = calls.find((c) => c.path === '/v0/quote').body;
  assert.equal(body.swapType, 'EXACT_OUTPUT');
  assert.equal(body.destinationAsset, USDC);
  assert.equal(body.amount, '392000000');
  assert.equal(body.recipient, 'marta.near');
  assert.equal(body.recipientType, 'DESTINATION_CHAIN');
  assert.equal(body.refundType, 'ORIGIN_CHAIN');
  assert.equal(body.slippageTolerance, 10, 'stablecoins: tight slippage');
  assert.equal(body.dry, false);
  assert.equal(calls.find((c) => c.path === '/v0/quote').headers['x-api-key'], 'KEY');

  await it.quote({ originAsset: 'nep141:tron-usdt.omft.near', symbol: 'USDT', amount: '100000000', payout: 'bch', recipient: 'bitcoincash:qp', refundTo: 'TRefund', deadline: Date.now() });
  const bch = calls.filter((c) => c.path === '/v0/quote').at(-1).body;
  assert.equal(bch.destinationAsset, PAYOUTS.bch.asset);
  assert.equal(bch.slippageTolerance, 100, 'paid out in a volatile coin: normal slippage');

  await it.status('MemoAddr', '123');
  assert.match(calls.at(-1).url, /depositAddress=MemoAddr&depositMemo=123$/);
});

test('payout addresses: Arbitrum and Bitcoin Cash formats, cashaddr gets its prefix', () => {
  assert.ok(isPayoutAddress('arb', '0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c'));
  assert.ok(!isPayoutAddress('arb', 'marta.near'));
  assert.ok(isPayoutAddress('bch', 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a'));
  assert.ok(isPayoutAddress('bch', 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a'));
  assert.ok(!isPayoutAddress('bch', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'), 'legacy addresses are not accepted');
  assert.equal(normalizePayoutAddress('bch', 'QPM2QSZNHKS23Z7629MMS6S4CWEF74VCWVY22GDX6A'), 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a');
  assert.equal(normalizePayoutAddress('near', '@Marta.near'), 'marta.near');
  assert.ok(!isPayoutAddress('sol', 'x'));
});

test('NEAR accounts: format check, then RPC; implicit accounts skip the RPC', async () => {
  assert.ok(isNearAccount('marta.near'));
  assert.ok(isNearAccount('a'.repeat(64)));
  assert.ok(isNearAccount('0x' + 'b'.repeat(40)));
  assert.ok(!isNearAccount('Marta.near'.toUpperCase().replace('.NEAR', '..near')));
  assert.ok(!isNearAccount('marta near'));
  const { fn, calls } = fakeFetch({ '/': (c) => (c.body.params.account_id === 'marta.near' ? { result: { amount: '1' } } : { error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }) });
  const it = createIntents({ base: 'https://1click.test', rpc: 'https://rpc.test/' }, fn);
  assert.equal(await it.accountExists('Marta.near'), true);
  assert.equal(await it.accountExists('nobody.near'), false);
  assert.equal(await it.accountExists('a'.repeat(64)), true);
  assert.equal(calls.length, 2);
});

// --- Test doubles ---

function fakeIntents() {
  const st = { statuses: {}, quotes: 0, accounts: new Set(['marta.near', 'augusto.near']) };
  return {
    st,
    payOptions: async () => [
      { assetId: USDC, symbol: 'USDC', chain: 'near', chainName: 'NEAR' },
      { assetId: 'nep141:tron-usdt.omft.near', symbol: 'USDT', chain: 'tron', chainName: 'Tron' },
    ],
    payoutUnits: async (cents, currency) => String(Math.round(cents * (currency === 'EUR' ? 112 : 100) * 100)),
    async quote(p) {
      st.quotes++;
      st.lastQuote = p;
      return { depositAddress: `DEP${st.quotes}`, amountInFormatted: (Number(p.amount) / 1e6 * 1.001).toFixed(2), deadline: new Date(p.deadline).toISOString(), signature: 'sig' };
    },
    async status(address) {
      return st.statuses[address] || { status: 'PENDING_DEPOSIT', swapDetails: {} };
    },
    accountExists: async (a) => st.accounts.has(a),
  };
}

const fakeNlu = async (_ai, text, ctx) => {
  const n = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/quien me debe|who owes/.test(n)) return { intent: 'debtors', draft: null, reply: '' };
  if (/cuanto he cobrado/.test(n)) return { intent: 'summary', draft: null, reply: '' };
  if (/marta/.test(n)) return { intent: 'invoice', reply: '', draft: normalizeDraft({ client_name: 'Marta García', items: [{ name: 'Diseño del logo', amount: /400/.test(n) ? 400 : 350 }], due_days: 15 }, ctx) };
  return { intent: 'chat', draft: null, reply: 'Hola 👋' };
};

function fakeApi() {
  const sent = [];
  let mid = 0;
  return {
    sent,
    async call(method, params) {
      if (method === 'sendMessage') { sent.push(params); return { message_id: ++mid }; }
      if (method === 'editMessageText') { sent.push({ ...params, edited: true }); return true; }
      if (method === 'getFile') return { file_path: 'voice/1.oga' };
      return true;
    },
    fileUrl: (p) => `https://files/${p}`,
  };
}

function setup({ concordium = null } = {}) {
  const cfg = loadConfig({ PUBLIC_URL: 'https://cobra.test' });
  const d1 = d1Shim();
  const db = createDb(d1);
  const api = fakeApi();
  const intents = fakeIntents();
  let now = T0;
  const clock = () => now;
  const payments = createPayments({ db, intents, concordium, api, cfg, clock });
  let n = 0;
  const bot = createBot({
    api, db, cfg, payments, intents, concordium, clock,
    nlu: fakeNlu,
    fixer: async (_ai, d, text) => ({ ...d, items: d.items.map((it) => ({ ...it, cents: /400/.test(text) ? 40000 : it.cents })) }),
    reminderWriter: async (_ai, inv) => `Hola ${inv.client_name}, te recuerdo la factura.`,
    stt: async () => ({ text: 'Factura a Marta 350 euros por el logo', seconds: 5 }),
    http: async () => new Response(new Uint8Array([1, 2, 3])),
    token: () => `tok${String(++n).padStart(20, '0')}`,
  });
  const ME = 42;
  const from = { id: ME, first_name: 'Augusto', language_code: 'es' };
  const msg = (text, extra = {}) => bot.handleUpdate({ message: { from, chat: { id: ME, type: 'private' }, text, ...extra } });
  const tap = (data, message_id = 1) => bot.handleUpdate({ callback_query: { id: 'c', from, data, message: { message_id, chat: { id: ME } } } });
  const last = () => api.sent.at(-1);
  const buttons = (m = last()) => (m.reply_markup?.inline_keyboard || []).flat();
  return { cfg, d1, db, bot, api, sent: api.sent, intents, payments, msg, tap, last, buttons, ME, at: (t) => (now = t) };
}

/** Voice/text → draft → first time asks where to get paid → payment link. */
async function invoiceMarta(s) {
  await s.msg('Factura a Marta 350 euros por el logo');
  await s.tap(s.buttons().find((b) => b.callback_data?.startsWith('send:')).callback_data);
  if (/Dónde quieres <b>cobrar/.test(s.last().text)) {
    await s.tap(s.buttons().find((b) => b.callback_data.startsWith('po:near:')).callback_data);
    await s.msg('augusto.near');
  }
  return s.db.invoiceById(1);
}

// --- Conversation ---

test('voice/text → draft → asks where to get paid once → payment link to share', async () => {
  const s = setup();
  await s.msg('Factura a Marta 350 euros por el logo');
  assert.match(s.last().text, /Borrador de factura/);
  assert.match(s.last().text, /350,00\s€/);
  assert.match(s.last().text, /Cobras en USDC · NEAR/);
  assert.ok(!/correo/.test(s.last().text), 'no email needed');
  const send = s.buttons().find((b) => b.callback_data.startsWith('send:'));
  await s.tap(send.callback_data);
  assert.match(s.last().text, /Dónde quieres <b>cobrar/);
  assert.deepEqual(s.buttons().map((b) => b.text), ['USDC · NEAR', 'USDC · Arbitrum', 'BCH · Bitcoin Cash', 'MUSD · Mezo', 'CCD · Concordium', 'sats · Lightning']);
  assert.equal(await s.db.invoiceById(1), null, 'nothing created yet');
  await s.tap(s.buttons()[0].callback_data);
  assert.match(s.last().text, /cuenta de NEAR/);

  await s.msg('nadie.near');
  assert.match(s.last().text, /No encuentro esa cuenta/);
  await s.msg('Augusto.near');
  const inv = await s.db.invoiceById(1);
  assert.equal(inv.payout_address, 'augusto.near');
  assert.equal(inv.payout_chain, 'near');
  assert.equal(inv.amount_cents, 35000);
  assert.equal(inv.currency, 'EUR');
  assert.equal(inv.pay_url, 'https://cobra.test/pay/tok00000000000000000001?lang=es');
  assert.match(s.last().text, /Enlace de pago listo/);
  const share = s.buttons().find((b) => b.url?.startsWith('https://t.me/share/url'));
  assert.ok(share, 'share button');
  assert.match(decodeURIComponent(share.url), /cobra\.test\/pay\/tok/);
  assert.match(decodeURIComponent(share.url), /Hola Marta/);

  // Second time: no question, straight to the link
  await s.msg('Otra a Marta 350 por el logo');
  await s.tap(s.buttons().find((b) => b.callback_data.startsWith('send:')).callback_data);
  assert.match(s.last().text, /Enlace de pago listo/);
  assert.equal((await s.db.invoiceById(2)).number, '0002');
});

test('fix a draft by voice/text, cancel, and the amount limit', async () => {
  const s = setup();
  await s.msg('Factura a Marta 350 euros');
  const id = s.buttons().find((b) => b.callback_data.startsWith('fix:')).callback_data.split(':')[1];
  await s.tap(`fix:${id}`);
  assert.match(s.last().text, /qué cambio/);
  await s.msg('que sean 400');
  assert.match(s.last().text, /400,00\s€/);
  await s.tap(`x:${id}`);
  assert.match(s.last().text, /descartado/);
  await s.tap(`send:${id}`);
  assert.match(s.last().text, /ya no está/);
  s.cfg.maxAmount = 100;
  await s.msg('Factura a Marta 350 euros');
  await s.tap(s.buttons().find((b) => b.callback_data.startsWith('send:')).callback_data);
  await s.tap(s.buttons().find((b) => b.callback_data.startsWith('po:near:')).callback_data);
  await s.msg('augusto.near');
  assert.match(s.last().text, /Supera el límite/);
});

// --- Payments ---

test('payment page flow: one deposit address per asset+refund, reused, and only for open invoices', async () => {
  const s = setup();
  const inv = await invoiceMarta(s);
  const usdt = 'nep141:tron-usdt.omft.near';
  const d1 = await s.payments.startPayment(inv, { assetId: usdt, refundTo: 'TMyAddr' });
  assert.equal(d1.address, 'DEP1');
  assert.equal(d1.chainName, 'Tron');
  assert.equal(s.intents.st.lastQuote.amount, '392000000', '350 € at 1.12');
  assert.equal(s.intents.st.lastQuote.recipient, 'augusto.near');
  assert.equal(s.intents.st.lastQuote.refundTo, 'TMyAddr');
  assert.equal((await s.payments.startPayment(inv, { assetId: usdt, refundTo: 'TMyAddr' })).address, 'DEP1', 'reused');
  assert.equal((await s.payments.startPayment(inv, { assetId: USDC, refundTo: 'client.near' })).address, 'DEP2');
  assert.equal(s.intents.st.quotes, 2);
  await assert.rejects(s.payments.startPayment(inv, { assetId: 'nep141:nope', refundTo: 'x1' }), (e) => e instanceof PayError && e.code === 'asset');
  await assert.rejects(s.payments.startPayment(inv, { assetId: usdt, refundTo: ' ' }), (e) => e.code === 'refund');
  s.at(T0 + 55 * MIN); // the first address expires within 10 min: a new one is quoted
  assert.equal((await s.payments.startPayment(inv, { assetId: usdt, refundTo: 'TMyAddr' })).address, 'DEP3');
  await s.db.setStatus(inv.id, 'CANCELLED', T0);
  await assert.rejects(s.payments.startPayment(await s.db.invoiceById(inv.id), { assetId: usdt, refundTo: 'TMyAddr' }), (e) => e.code === 'closed');
});

test('1Click progress: incoming alert once, paid alert once with the transaction, extra and refunded payments reported', async () => {
  const s = setup();
  const inv = await invoiceMarta(s);
  await s.payments.startPayment(inv, { assetId: 'nep141:tron-usdt.omft.near', refundTo: 'TMyAddr' });
  await s.payments.startPayment(inv, { assetId: USDC, refundTo: 'client.near' });
  const before = s.sent.length;

  s.at(T0 + 2 * MIN);
  assert.equal(await s.payments.sweep(), 2);
  assert.equal(s.sent.length, before, 'nothing happened yet');

  s.intents.st.statuses.DEP1 = { status: 'PROCESSING', swapDetails: { depositedAmountFormatted: '392.39' } };
  s.at(T0 + 4 * MIN);
  await s.payments.sweep();
  assert.match(s.last().text, /Marta García está pagando<\/b>: 392.39 USDT · Tron/);
  s.at(T0 + 6 * MIN);
  await s.payments.sweep();
  assert.equal(s.sent.length, before + 1, 'incoming said once');

  s.intents.st.statuses.DEP1 = { status: 'SUCCESS', swapDetails: { amountInFormatted: '392.39', destinationChainTxHashes: [{ hash: 'h', explorerUrl: 'https://nearblocks.io/txns/h' }] } };
  s.at(T0 + 8 * MIN);
  await s.payments.sweep();
  assert.match(s.last().text, /Marta García te ha pagado 350,00\s€/);
  assert.match(s.last().text, /392.39 USDT · Tron/);
  assert.equal(s.buttons()[0].url, 'https://nearblocks.io/txns/h');
  const paid = await s.db.invoiceById(1);
  assert.equal(paid.status, 'PAID');
  assert.equal(paid.paid_with, '392.39 USDT · Tron');
  assert.equal(paid.paid_tx, 'https://nearblocks.io/txns/h');
  s.at(T0 + 10 * MIN);
  assert.equal(await s.payments.sweep(), 1, 'the paid deposit is not checked again');

  s.intents.st.statuses.DEP2 = { status: 'SUCCESS', swapDetails: { amountInFormatted: '392.00' } };
  s.at(T0 + 12 * MIN);
  await s.payments.sweep();
  assert.match(s.last().text, /otro pago de una factura que ya estaba pagada/);

  const s2 = setup();
  const inv2 = await invoiceMarta(s2);
  await s2.payments.startPayment(inv2, { assetId: USDC, refundTo: 'client.near' });
  s2.intents.st.statuses.DEP1 = { status: 'REFUNDED', swapDetails: { amountInFormatted: '10', refundReason: 'deadline passed' } };
  s2.at(T0 + 2 * MIN);
  await s2.payments.sweep();
  assert.match(s2.last().text, /se le ha devuelto \(deadline passed\)/);
  assert.equal((await s2.db.invoiceById(1)).status, 'SENT');
});

test('who owes me asks 1Click first, so a payment the clock has not seen yet still counts', async () => {
  const s = setup();
  const inv = await invoiceMarta(s);
  await s.payments.startPayment(inv, { assetId: USDC, refundTo: 'client.near' });
  await s.msg('¿quién me debe?');
  assert.match(s.last().text, /1 factura sin pagar/);
  s.intents.st.statuses.DEP1 = { status: 'SUCCESS', swapDetails: { amountInFormatted: '392.00' } };
  s.at(T0 + MIN);
  await s.msg('¿quién me debe?');
  assert.match(s.last().text, /nadie te debe nada/);
  await s.msg('¿cuánto he cobrado este mes?');
  assert.match(s.last().text, /cobrado <b>350,00\s€<\/b> \(1\)/);
});

test('reminder: written by AI, forwarded with the payment link; get paid in person', async () => {
  const s = setup();
  await invoiceMarta(s);
  s.at(T0 + 20 * 86_400_000);
  await s.msg('💸 Quién me debe');
  assert.match(s.last().text, /vencida hace 5 días/);
  await s.tap(s.buttons().find((b) => b.callback_data?.startsWith('rem:')).callback_data);
  assert.match(s.last().text, /Recordatorio para Marta García/);
  const fwd = decodeURIComponent(s.buttons()[0].url);
  assert.match(fwd, /te recuerdo la factura/);
  assert.match(fwd, /cobra\.test\/pay\//);
  await s.msg('💸 Quién me debe');
  assert.match(s.last().text, /recordada/);
  await s.tap('qr:1');
  assert.match(s.last().text, /enséñasela a Marta García/);
  assert.equal(s.buttons()[0].url, 'https://cobra.test/pay/tok00000000000000000001?lang=es');
});

test('the clock follows payments every minute and warns once about overdue invoices', async () => {
  const s = setup();
  const inv = await invoiceMarta(s);
  await s.payments.startPayment(inv, { assetId: USDC, refundTo: 'client.near' });
  const before = s.sent.length;
  assert.equal(await s.bot.tick(T0 + 2 * MIN), 'done');
  assert.equal(await s.bot.tick(T0 + 4 * MIN), 'payments:1');
  assert.equal(s.sent.length, before);
  const late = T0 + 20 * 86_400_000;
  s.at(late);
  await s.bot.tick(late);
  assert.match(s.last().text, /Marta García aún no ha pagado/);
  const warned = s.sent.length;
  await s.bot.tick(late + 3_600_000);
  assert.equal(s.sent.length, warned, 'only one warning per invoice');
});

// --- Worker: the client's side ---

test('payment page: renders the invoice, quotes, reports status; unknown tokens are 404', async () => {
  const s = setup();
  await invoiceMarta(s);
  const env = { DB: s.d1, BOT_TOKEN: 'T', PUBLIC_URL: 'https://cobra.test' };
  const deps = { intents: s.intents, api: s.api, clock: () => T0 };
  const call = (path, init) => worker.fetch(new Request(`https://cobra.test${path}`, init), env, { waitUntil() {} }, deps);

  const page = await call('/pay/tok00000000000000000001');
  assert.equal(page.status, 200);
  const htmlText = await page.text();
  assert.match(htmlText, /"amount":350/);
  assert.match(htmlText, /"recipient":"augusto.near"/);
  assert.match(htmlText, /USDT/);
  assert.ok(!htmlText.includes('"user_id"'), 'no internal ids on the page');
  assert.ok(!htmlText.includes('</script><'), 'embedded JSON cannot break out');

  const bad = await call('/pay/tok00000000000000000001/quote', { method: 'POST', body: JSON.stringify({ assetId: USDC, refundTo: '' }) });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'refund');
  const ok = await call('/pay/tok00000000000000000001/quote', { method: 'POST', body: JSON.stringify({ assetId: USDC, refundTo: 'client.near' }) });
  const dep = await ok.json();
  assert.equal(dep.address, 'DEP1');

  s.intents.st.statuses.DEP1 = { status: 'SUCCESS', swapDetails: { amountInFormatted: '392.00' } };
  const st = await (await call('/pay/tok00000000000000000001/status?d=DEP1')).json();
  assert.equal(st.invoice.status, 'PAID');
  assert.equal(st.deposit.status, 'SUCCESS');
  assert.match(s.last().text, /te ha pagado/);

  assert.equal((await call('/pay/tok00000000000000000099')).status, 404);
  assert.equal((await call('/pay/<script>')).status, 404);
});

// --- Mini App, CSV, budget, settings ---

async function signInitData(fields, token) {
  const enc = new TextEncoder();
  const mac = async (key, msg) => {
    const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
  };
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const hash = Buffer.from(await mac(await mac('WebAppData', token), check)).toString('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

test('Mini App: only initData signed with our token gets in, and it expires', async () => {
  const fields = { auth_date: '1000', query_id: 'q', user: JSON.stringify({ id: 42, first_name: 'Ana & Co' }) };
  const good = await signInitData(fields, 'TOKEN');
  assert.equal((await verifyInitData(good, 'TOKEN', 2000)).id, 42);
  assert.equal(await verifyInitData(good, 'OTHER', 2000), null);
  assert.equal(await verifyInitData(good, 'TOKEN', 1000 + 90_000), null, 'expired');
});

test('CSV: amounts stay numbers, commas are quoted, formulas are defused', () => {
  const row = toRow({ id: 1, number: '0001', client_name: '=HYPERLINK("x")', client_email: null, description: 'Logo, v2', amount_cents: 35050, currency: 'EUR', due_date: null, status: 'PAID', created_at: T0, paid_at: T0, pay_url: null });
  const [, line] = toCsv([row]).split('\r\n');
  assert.match(line, /^0001,"'=HYPERLINK\(""x""\)",,"Logo, v2",350\.5,EUR,PAID,2026-11-03,,2026-11-03$/);
});

test('the daily AI budget is shared by all users and resets the next day', async () => {
  const kv = new Map();
  const db = { kvGet: async (k) => kv.get(k) ?? null, kvSet: async (k, v) => kv.set(k, String(v)) };
  let now = T0;
  let calls = 0;
  const ai = budgetedAi({ run: async () => ++calls }, db, 2, () => now);
  await ai.run('m', {});
  await ai.run('m', {});
  await assert.rejects(ai.run('m', {}), /budget/);
  now += 86_400_000;
  await ai.run('m', {});
  assert.equal(calls, 3);
});

test('settings: language, currency and where I get paid (NEAR, Arbitrum, BCH)', async () => {
  const s = setup();
  await s.msg('⚙️ Ajustes');
  assert.match(s.last().text, /Moneda de las facturas: EUR/);
  await s.tap('cur:USD');
  assert.match(s.last().text, /Moneda de las facturas: USD/);
  await s.tap('po');
  assert.match(s.last().text, /Dónde quieres <b>cobrar/);
  await s.tap('po:arb:0');
  assert.match(s.last().text, /dirección de <b>USDC · Arbitrum/);
  await s.msg('0x123');
  assert.match(s.last().text, /no parece una dirección de Arbitrum/);
  await s.msg('0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c');
  assert.match(s.last().text, /Cobrarás en <b>USDC · Arbitrum<\/b>/);
  await s.tap('po:near:0');
  await s.msg('marta.near');
  assert.match(s.last().text, /Cobrarás en <b>USDC · NEAR<\/b> en <code>marta.near<\/code>/);
  await s.tap('lang:en');
  assert.match(s.last().text, /Get paid in: USDC · NEAR · <code>marta.near<\/code>/);
  await s.msg('❓ How it works');
  assert.match(s.last().text, /you receive USDC on NEAR/);
});

// --- Mezo: MUSD paid directly ---

test('Mezo helpers: exact tagged amounts, formatting, ERC-20 calldata', () => {
  const wei = taggedAmount('11200000', 7); // 11.20 USDC-equivalent, invoice 7
  assert.equal(wei, '11200000000000000007');
  assert.equal(formatUnits(wei), '11.200000000000000007');
  assert.equal(formatUnits('5000000000000000000'), '5');
  assert.equal(transferData('0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c', 1),
    '0xa9059cbb0000000000000000000000005a0b54d5dc17e0aadc383d2db43b0a0d3e029c4c0000000000000000000000000000000000000000000000000000000000000001');
});

test('Mezo: findTransfer scans in ranges and matches the exact amount to the freelancer', async () => {
  const calls = [];
  const fn = async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    calls.push({ method, params });
    if (method === 'eth_blockNumber') return Response.json({ result: '0x2710' }); // 10000
    const { fromBlock, topics } = params[0];
    assert.equal(topics[2], '0x0000000000000000000000005a0b54d5dc17e0aadc383d2db43b0a0d3e029c4c');
    const logs = fromBlock === '0x1388' ? [ // 5000
      { data: '0x' + (11200000000000000006n).toString(16), transactionHash: '0xother', blockNumber: '0x1390' },
      { data: '0x' + (11200000000000000007n).toString(16), transactionHash: '0xmine', blockNumber: '0x1391' },
    ] : [];
    return Response.json({ result: logs });
  };
  const m = createMezo('testnet', fn);
  const r = await m.findTransfer('0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c', '11200000000000000007', 0);
  assert.deepEqual(r.found, { hash: '0xmine', block: 5009 });
  assert.equal(calls.filter((c) => c.method === 'eth_getLogs').length, 2, 'two 5000-block ranges');
  assert.equal(m.txUrl('0xmine'), 'https://explorer.test.mezo.org/tx/0xmine');
  const none = await m.findTransfer('0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c', '1', 0, 1);
  assert.equal(none.found, null);
  assert.equal(none.scanned, 4999, 'resumes where it stopped');
});

test('Mezo invoices: the page offers MUSD direct, the chain is watched, the freelancer is told once', async () => {
  const s = setup();
  let transfers = [];
  const mezo = {
    net: { chainId: 31611, name: 'Mezo Testnet', rpc: 'https://rpc.test', explorer: 'https://explorer.test', musd: '0xMUSD' },
    blockNumber: async () => 100,
    async findTransfer(to, wei, from) {
      const hit = transfers.find((x) => x.to === to && x.wei === wei && x.block >= from);
      return { found: hit ? { hash: hit.hash, block: hit.block } : null, scanned: 200 };
    },
    txUrl: (h) => `https://explorer.test/tx/${h}`,
  };
  const payments = createPayments({ db: s.db, intents: s.intents, mezo, api: s.api, cfg: s.cfg, clock: () => T0 });
  await s.msg('Factura a Marta 350 euros por el logo');
  await s.tap(s.buttons().find((b) => b.callback_data.startsWith('send:')).callback_data);
  await s.tap(s.buttons().find((b) => b.callback_data.startsWith('po:mezo:')).callback_data);
  assert.match(s.last().text, /dirección de <b>MUSD · Mezo/);
  await s.msg('0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c');
  const inv = await s.db.invoiceById(1);
  assert.equal(inv.payout_chain, 'mezo');

  await assert.rejects(payments.startPayment(inv, { assetId: USDC, refundTo: 'x.near' }), (e) => e.code === 'asset');
  const d = await payments.startPayment(inv, { assetId: 'mezo:musd' });
  assert.equal(d.address, '0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c', 'pay straight to the freelancer');
  assert.equal(d.amountIn, '392.000000000000000001', '350 € → 392 MUSD, tagged with invoice 1');
  assert.equal(d.direct.chainId, '0x7b7b');
  assert.match(d.direct.data, /^0xa9059cbb/);
  assert.equal((await payments.startPayment(inv, { assetId: 'mezo:musd' })).key, d.key, 'one watch per invoice');

  const dep = await s.db.getDeposit(d.key);
  assert.equal(await payments.refresh(dep), 'PENDING_DEPOSIT');
  transfers = [{ to: d.address, wei: '392000000000000000001', hash: '0xabc', block: 250 }];
  assert.equal(await payments.refresh(await s.db.getDeposit(d.key)), 'SUCCESS');
  assert.match(s.last().text, /Marta García te ha pagado 350,00\s€/);
  assert.match(s.last().text, /392.000000000000000001 MUSD · Mezo/);
  assert.equal(s.buttons()[0].url, 'https://explorer.test/tx/0xabc');
  assert.equal((await s.db.invoiceById(1)).status, 'PAID');
});

// --- Concordium: CCD invoices, x402, Verified by Concordium badge ---

const ACC = '3z9dkoTnLi2HEZvjnmKrMec2Gk2NKcEhdi4PugDWzP4GQtZiFa';
const PAYER = '437cES8dVEU62XX3G1SbFBRKvi8ewueHS7ADQgJjQSpiS5rHGu';
const HASH = 'a'.repeat(64);
const xPayment = (hash) => Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'concordium:testnet', payload: { txHash: hash } })).toString('base64');

test('Concordium helpers: tagged microCCD, formatting, X-PAYMENT parsing', () => {
  assert.equal(taggedCcd(500, 0.0025, 3), '2000000003', '5 € at 0.0025 €/CCD = 2000 CCD, tagged with invoice 3');
  assert.equal(formatCcd('2000000003'), '2000.000003');
  assert.equal(formatCcd('5000000'), '5');
  assert.equal(parsePaymentHeader(xPayment(HASH.toUpperCase())), HASH);
  assert.equal(parsePaymentHeader(Buffer.from(JSON.stringify({ txHash: HASH })).toString('base64')), HASH);
  assert.equal(parsePaymentHeader('nope'), null);
  assert.equal(parsePaymentHeader(xPayment('123')), null);
});

test('Concordium: a transfer counts only if finalized, successful, to the freelancer and exact', async () => {
  const statuses = {
    [HASH]: { status: 'finalized', outcome: 'success', to: ACC, amount: '2000000003', sender: PAYER },
    ['b'.repeat(64)]: { status: 'committed' },
    ['c'.repeat(64)]: { status: 'finalized', outcome: 'success', to: ACC, amount: '2000000002', sender: PAYER },
  };
  const fn = async (url) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/v0/submissionStatus/')) return Response.json(statuses[u.pathname.split('/').pop()] || { status: 'absent' });
    if (u.pathname.startsWith('/v1/accTransactions/')) return Response.json({ transactions: [{ transactionHash: HASH, blockTime: T0 / 1000, details: { type: 'transfer', outcome: 'success', transferDestination: ACC, transferAmount: '2000000003', transferSource: PAYER } }] });
    if (u.host === 'agent-registry-mcp.concordium.com') return Response.json({ summary: { valid: 1, invalid: 0 }, owner: ACC });
    return Response.json({});
  };
  const c = createConcordium('testnet', fn);
  assert.deepEqual(await c.verifyTransfer(HASH, ACC, '2000000003'), { ok: true, sender: PAYER });
  assert.equal((await c.verifyTransfer('b'.repeat(64), ACC, '2000000003')).pending, true);
  assert.equal((await c.verifyTransfer('c'.repeat(64), ACC, '2000000003')).why, 'wrong amount');
  assert.equal((await c.verifyTransfer('d'.repeat(64), ACC, '1')).why, 'unknown transaction');
  assert.equal((await c.verifyTransfer(HASH, PAYER, '2000000003')).why, 'wrong recipient');
  assert.equal((await c.findTransfer(ACC, '2000000003', T0)).hash, HASH);
  assert.equal(await c.findTransfer(ACC, '2000000003', T0 + 3_600_000), null, 'older than the invoice');
  assert.equal((await c.checkBadge('Mf22soLh1NuZYFgBK8iSs')).valid, true);
});

function fakeConcordium() {
  const st = { transfers: {}, account: ACC };
  return {
    st,
    net: { name: 'Concordium Testnet', x402: 'concordium:testnet' },
    price: async () => 0.0025,
    accountExists: async (a) => a === st.account,
    async verifyTransfer(hash, to, micro) {
      const t = st.transfers[hash];
      if (!t) return { ok: false, why: 'unknown transaction' };
      if (t.to !== to || t.micro !== micro) return { ok: false, why: 'wrong amount' };
      return { ok: true, sender: PAYER };
    },
    findTransfer: async () => null,
    txUrl: (h) => `https://ccdexplorer.io/testnet/transaction/${h}`,
    checkBadge: async () => ({ valid: true, url: 'https://agent-registry-mcp.concordium.com/v1/check-badge/Mf22?network=testnet' }),
  };
}

test('x402: 402 with requirements, then an AI agent pays with a tx hash; hashes are single use', async () => {
  const concordium = fakeConcordium();
  const s = setup({ concordium });
  const env = { DB: s.d1, BOT_TOKEN: 'T', PUBLIC_URL: 'https://cobra.test', CONCORDIUM_BADGE: 'Mf22soLh1NuZYFgBK8iSs' };
  const deps = { intents: s.intents, api: s.api, concordium, clock: () => T0 };
  const call = (path, init) => worker.fetch(new Request(`https://cobra.test${path}`, init), env, { waitUntil() {} }, deps);

  await s.msg('Factura a Marta 350 euros por el logo');
  await s.tap(s.buttons().find((b) => b.callback_data.startsWith('send:')).callback_data);
  await s.tap(s.buttons().find((b) => b.callback_data.startsWith('po:ccd:')).callback_data);
  await s.msg('nope');
  assert.match(s.last().text, /no parece una dirección de Concordium/);
  await s.msg(ACC);
  const inv = await s.db.invoiceById(1);
  assert.equal(inv.payout_chain, 'ccd');
  const path = `/x402/${inv.pay_token}`;

  const r1 = await call(path);
  assert.equal(r1.status, 402);
  const req = (await r1.json()).accepts[0];
  assert.equal(req.scheme, 'exact');
  assert.equal(req.network, 'concordium:testnet');
  assert.equal(req.payTo, ACC);
  assert.equal(req.maxAmountRequired, '140000000001', '350 € at 0.0025 €/CCD = 140000 CCD, tagged with invoice 1');
  assert.ok(r1.headers.get('payment-required'));

  assert.equal((await (await call(path, { headers: { 'x-payment': 'garbage' } })).json()).error, 'X-PAYMENT must be base64 JSON with payload.txHash');
  assert.equal((await (await call(path, { headers: { 'x-payment': xPayment(HASH) } })).json()).error, 'unknown transaction');

  concordium.st.transfers[HASH] = { to: ACC, micro: '140000000001' };
  const ok = await call(path, { headers: { 'x-payment': xPayment(HASH) } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).paid, true);
  const receipt = JSON.parse(Buffer.from(ok.headers.get('x-payment-response'), 'base64').toString());
  assert.deepEqual(receipt, { success: true, transaction: HASH, network: 'concordium:testnet', payer: PAYER });
  assert.equal((await s.db.invoiceById(1)).status, 'PAID');
  assert.match(s.last().text, /Marta García te ha pagado 350,00\s€/);
  assert.match(s.last().text, /140000.000001 CCD · Concordium/);
  assert.equal(s.buttons()[0].url, `https://ccdexplorer.io/testnet/transaction/${HASH}`);
  assert.equal((await call(path)).status, 200, 'paid: no more 402');

  // The same hash cannot pay a second invoice
  await s.msg('Otra a Marta 350 por el logo');
  await s.tap(s.buttons().find((b) => b.callback_data.startsWith('send:')).callback_data);
  const inv2 = await s.db.invoiceById(2);
  concordium.st.transfers[HASH] = { to: ACC, micro: '140000000002' };
  assert.equal((await (await call(`/x402/${inv2.pay_token}`, { headers: { 'x-payment': xPayment(HASH) } })).json()).error, 'payment already used');

  // The payment page carries the live badge
  const page = await (await call(`/pay/${inv2.pay_token}`)).text();
  assert.match(page, /"token":"Mf22soLh1NuZYFgBK8iSs"/);
  assert.equal((await call('/x402/tok00000000000000000099')).status, 404);
});

test('Agent Card: stored with the setup secret, served byte for byte for the on-chain hash', async () => {
  const s = setup();
  const env = { DB: s.d1, WEBHOOK_SECRET: 'S' };
  const call = (path, init) => worker.fetch(new Request(`https://cobra.test${path}`, init), env, { waitUntil() {} }, { intents: s.intents, api: s.api });
  assert.equal((await call('/.well-known/agent-card.json')).status, 404);
  const card = '{"type":"https://eips.ethereum.org/EIPS/eip-8004#registration-v1","name":"Cobra"}';
  assert.equal((await call('/setup/agent-card?secret=bad', { method: 'POST', body: card })).status, 403);
  const r = await (await call('/setup/agent-card?secret=S', { method: 'POST', body: card })).json();
  assert.equal(r.sha256, createHash('sha256').update(card).digest('hex'));
  assert.equal(await (await call('/.well-known/agent-card.json')).text(), card);
});

// --- Lightning address + Cashu ecash ---

test('Lightning: address → LNURL-pay, BOLT11 amounts, the invoice must be for what we asked', async () => {
  assert.equal(lnurlpUrl('Marta@Minibits.Cash'), 'https://minibits.cash/.well-known/lnurlp/marta');
  assert.equal(lnurlpUrl('marta.near'), null);
  assert.equal(bolt11Msat('lnbc2500u1pvjluez'), 250_000_000);
  assert.equal(bolt11Msat('lnbc10n1abc'), 1_000);
  assert.equal(bolt11Msat('lnbc1pvjluez'), null, 'no amount: not ours');
  let pr = 'lnbc5000n1qqq';
  const fn = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/.well-known/lnurlp/marta') return Response.json({ tag: 'payRequest', callback: 'https://minibits.cash/cb/marta', minSendable: 1000, maxSendable: 1e10, commentAllowed: 10 });
    if (u.pathname === '/cb/marta') return Response.json({ pr, verify: 'https://minibits.cash/verify/1', comment: u.searchParams.get('comment') });
    if (u.pathname === '/verify/1') return Response.json({ status: 'OK', settled: true });
    return Response.json({ status: 'ERROR', reason: 'nope' }, { status: 404 });
  };
  const ln = createLightning(fn);
  assert.ok(await ln.resolve('marta@minibits.cash'));
  assert.equal(await ln.resolve('nobody@minibits.cash'), null);
  assert.deepEqual(await ln.invoice('marta@minibits.cash', 500), { pr, verify: 'https://minibits.cash/verify/1', msat: 500_000 });
  assert.equal(await ln.settled('https://minibits.cash/verify/1'), true);
  pr = 'lnbc9000n1qqq';
  await assert.rejects(ln.invoice('marta@minibits.cash', 500), /another amount/);
});

/** A mint that pays any invoice with 2 sats of routing reserve; it fails on demand. */
function fakeMintWallet({ fail = false, proofs }) {
  const amt = (n) => ({ n, add: (o) => amt(n + o.n), toNumber: () => n, toString: () => String(n) });
  const calls = [];
  return {
    calls,
    make: () => ({
      loadMint: async () => calls.push('load'),
      decodeToken: () => ({ proofs }),
      createMeltQuoteBolt11: async (pr) => { calls.push(['quote', pr]); return { quote: 'q1', amount: amt(bolt11Msat(pr) / 1000), fee_reserve: amt(2) }; },
      send: async (need, held) => {
        const total = held.reduce((s, p) => s + p.amount, 0);
        return { send: [{ id: '009a1f293253e41e', amount: need.n, secret: 'send', C: '02' + 'c'.repeat(64) }], keep: total > need.n ? [{ id: '009a1f293253e41e', amount: total - need.n, secret: 'keep', C: '02' + 'd'.repeat(64) }] : [] };
      },
      meltProofsBolt11: async () => {
        if (fail) throw new Error('Lightning payment failed');
        return { quote: { state: 'PAID', payment_preimage: 'pre' }, change: [{ id: '009a1f293253e41e', amount: 1, secret: 'chg', C: '02' + 'e'.repeat(64) }] };
      },
    }),
  };
}

test('Cashu: a token is melted into the invoice, change and failures go back to the client', async () => {
  const { getEncodedToken } = await import('@cashu/cashu-ts');
  const proofs = [{ id: '009a1f293253e41e', amount: 512, secret: 's1', C: '02' + 'a'.repeat(64) }];
  const token = getEncodedToken({ mint: 'https://mint.test', unit: 'sat', proofs });
  assert.deepEqual(inspectToken(token), { mint: 'https://mint.test', unit: 'sat', amount: 512 });
  assert.equal(inspectToken('hello'), null);

  const ok = fakeMintWallet({ proofs });
  const r = await payWithToken(token, 'lnbc5000n1qqq', ok.make);
  assert.equal(r.paid, true);
  assert.equal(r.fee, 2);
  assert.deepEqual(inspectToken(r.change), { mint: 'https://mint.test', unit: 'sat', amount: 11 }, '512 - 502 kept + 1 change');

  const bad = fakeMintWallet({ proofs, fail: true });
  const f = await payWithToken(token, 'lnbc5000n1qqq', bad.make);
  assert.equal(f.paid, false);
  assert.match(f.why, /failed/);
  assert.equal(inspectToken(f.change).amount, 512, 'everything back');

  const small = fakeMintWallet({ proofs });
  const s = await payWithToken(token, 'lnbc6000n1qqq', small.make);
  assert.equal(s.paid, false);
  assert.match(s.why, /holds 512 sats, 602 needed/);
  assert.equal(inspectToken(s.change).amount, 512);
  assert.equal((await payWithToken('cashuBnope', 'lnbc1', ok.make)).why, 'not a Cashu token');
});

test('Lightning invoices: fresh BOLT11 per attempt, ecash pays it, the freelancer is told', async () => {
  const s = setup();
  const lightning = {
    resolve: async (a) => (a === 'marta@minibits.cash' ? { tag: 'payRequest' } : null),
    invoice: async (_a, sats) => ({ pr: `lnbc${sats * 10}n1qqq`, verify: null, msat: sats * 1000 }),
    settled: async () => false,
  };
  s.intents.satsFor = async () => 5000;
  const env = { DB: s.d1, BOT_TOKEN: 'T', PUBLIC_URL: 'https://cobra.test' };
  let melted = null;
  const deps = { intents: s.intents, api: s.api, lightning, clock: () => T0, cashuPay: async (token, pr) => { melted = { token, pr }; return { paid: true, change: 'cashuBchange' }; } };
  const call = (path, init) => worker.fetch(new Request(`https://cobra.test${path}`, init), env, { waitUntil() {} }, deps);

  const bot = createBot({ api: s.api, db: s.db, cfg: s.cfg, payments: s.payments, intents: s.intents, lightning, clock: () => T0, nlu: fakeNlu, token: () => 'tokLN0000000000000000001' });
  const from = { id: s.ME, first_name: 'Augusto', language_code: 'es' };
  const tap = (data) => bot.handleUpdate({ callback_query: { id: 'c', from, data, message: { message_id: 1, chat: { id: s.ME } } } });
  await bot.handleUpdate({ message: { from, chat: { id: s.ME, type: 'private' }, text: 'Factura a Marta 350 euros por el logo' } });
  await tap(s.buttons().find((b) => b.callback_data.startsWith('send:')).callback_data);
  await tap('po:ln:1');
  await bot.handleUpdate({ message: { from, chat: { id: s.ME, type: 'private' }, text: 'nobody@minibits.cash' } });
  assert.match(s.last().text, /no parece una dirección de Lightning/);
  await bot.handleUpdate({ message: { from, chat: { id: s.ME, type: 'private' }, text: 'Marta@Minibits.cash' } });
  const inv = await s.db.invoiceById(1);
  assert.equal(inv.payout_chain, 'ln');
  assert.equal(inv.payout_address, 'marta@minibits.cash');

  const page = await (await call(`/pay/${inv.pay_token}`)).text();
  assert.match(page, /"symbol":"Lightning","chain":"ln"/);
  const d = await (await call(`/pay/${inv.pay_token}/quote`, { method: 'POST', body: JSON.stringify({ assetId: 'ln:bolt11' }) })).json();
  assert.equal(d.direct.kind, 'ln');
  assert.equal(d.direct.pr, 'lnbc50000n1qqq');
  assert.equal(d.amountIn, '5000');

  const r = await (await call(`/pay/${inv.pay_token}/cashu`, { method: 'POST', body: JSON.stringify({ key: d.key, token: 'cashuBxyz' }) })).json();
  assert.deepEqual(r, { paid: true, change: 'cashuBchange', why: null });
  assert.deepEqual(melted, { token: 'cashuBxyz', pr: 'lnbc50000n1qqq' });
  assert.equal((await s.db.invoiceById(1)).status, 'PAID');
  assert.match(s.last().text, /te ha pagado 350,00\s€/);
  assert.match(s.last().text, /5000 sats · Cashu ecash/);
  const again = await (await call(`/pay/${inv.pay_token}/cashu`, { method: 'POST', body: JSON.stringify({ key: d.key, token: 'cashuBxyz' }) })).json();
  assert.equal(again.paid, false, 'a paid invoice is not paid twice');
});

test('the bot follows the language of the message: an English voice note gets English replies and an English payment page', async () => {
  const s = setup();
  const nluEn = async (_ai, text, ctx) => ({ ...(await fakeNlu(_ai, text, ctx)), lang: /bill/i.test(text) ? 'en' : null });
  const bot = createBot({ api: s.api, db: s.db, cfg: s.cfg, payments: s.payments, intents: s.intents, clock: () => T0, nlu: nluEn, token: () => 'tokEN0000000000000000001' });
  const from = { id: s.ME, first_name: 'Augusto', language_code: 'es' };
  await bot.handleUpdate({ message: { from, chat: { id: s.ME, type: 'private' }, text: 'Bill Marta 5 dollars for the logo' } });
  assert.match(s.last().text, /Invoice draft/);
  assert.equal((await s.db.getUser(s.ME)).lang, 'en');
});

// --- Bitcoin Cash (BCH BLAZE): BCH and PUSD straight to the freelancer, WizardConnect on the page ---

import { BCH_ASSET, PUSD_ASSET, PUSD, createBch, decodeCashAddr, plainCashAddr, tokenCashAddr, lockingHex, taggedSats, memoHex, readMemo, bip21, matches } from '../src/bch.js';

const ZADDR = 'bitcoincash:zpwlcxelj25wkpsq7qjmyftfy4tt7hnefvk3jhxmcx';
const QADDR = 'bitcoincash:qpwlcxelj25wkpsq7qjmyftfy4tt7hnefv3mpfga84';

test('BCH helpers: cashaddr forms, locking script, tagged sats, memo, BIP21', () => {
  assert.equal(plainCashAddr(ZADDR), QADDR, 'z… (tokens) and q… are the same key');
  assert.equal(tokenCashAddr(QADDR), ZADDR);
  assert.equal(decodeCashAddr(ZADDR).tokens, true);
  assert.equal(decodeCashAddr('bitcoincash:qpwlcxelj25wkpsq7qjmyftfy4tt7hnefv3mpfga85'), null, 'bad checksum');
  assert.ok(isPayoutAddress('bch', ZADDR), 'token-aware addresses are accepted');
  assert.equal(lockingHex(ZADDR), '76a9145dfc1b3f92a8eb0600f025b225692556bf5e794b88ac');
  assert.equal(taggedSats(123456, 42), 124042, 'price rounded up to 1000 sats + invoice id');
  assert.equal(taggedSats(123000, 1042), 123042);
  assert.equal(readMemo(memoHex(42)), '42');
  assert.equal(readMemo('6a0442434d52'), null, 'other OP_RETURNs are not ours');
  assert.equal(bip21(ZADDR, 124042, 'Cobra 7'), `${QADDR}?amount=0.00124042&message=Cobra%207`);
});

test('BCH payment matching: tagged amount, or memo + price; PUSD exact, or memo + at least the price', () => {
  const script = lockingHex(ZADDR);
  const out = (sats, extra = {}) => ({ value: sats / 1e8, scriptPubKey: { hex: script }, ...extra });
  const memo = { value: 0, scriptPubKey: { hex: memoHex(7) } };
  const w = { kind: 'bch', script, sats: 124007, minSats: 122760, invoiceId: 7 };
  assert.ok(matches({ vout: [out(124007)] }, w), 'exact tagged amount, from any wallet');
  assert.ok(!matches({ vout: [out(124000)] }, w), 'untagged amount without memo is not ours');
  assert.ok(matches({ vout: [out(123500), memo] }, w), 'memo + at least the price');
  assert.ok(!matches({ vout: [out(100000), memo] }, w), 'memo but too little');
  const tok = (amount, category = PUSD.category) => out(1000, { tokenData: { category, amount: String(amount) } });
  const p = { kind: 'pusd', script, cents: 39200, invoiceId: 7 };
  assert.ok(matches({ vout: [tok(39200)] }, p));
  assert.ok(!matches({ vout: [tok(39200, 'ab'.repeat(32))] }, p), 'another token is not PUSD');
  assert.ok(matches({ vout: [tok(39300), memo] }, p));
  assert.ok(!matches({ vout: [tok(39300)] }, p), 'without memo only the exact amount counts');
});

test('BCH chain: findPayment reads history and mempool, falls back to the next server', async () => {
  const script = lockingHex(ZADDR);
  const txs = { a1: { vout: [{ value: 0.5, scriptPubKey: { hex: script } }] }, b2: { vout: [{ value: 0.00124007, scriptPubKey: { hex: script } }] } };
  const used = [];
  const connect = async (url) => {
    used.push(url);
    if (url === 'down') throw new Error('unreachable');
    return {
      close() {},
      async call(method, ...params) {
        if (method === 'server.version') return ['Fulcrum', '1.5'];
        if (method === 'blockchain.headers.get_tip') return { height: 900 };
        if (method === 'blockchain.address.get_history') { assert.equal(params[0], QADDR, 'Fulcrum gets the plain address'); return [{ tx_hash: 'a1', height: 100 }, { tx_hash: 'b2', height: 0 }]; }
        if (method === 'blockchain.transaction.get') return txs[params[0]];
        throw new Error(method);
      },
    };
  };
  const c = createBch({ servers: ['down', 'up'], connect });
  assert.equal(await c.tip(), 900);
  assert.deepEqual(await c.findPayment({ kind: 'bch', to: ZADDR, script, sats: 124007, minSats: 1, invoiceId: 7, fromHeight: 890 }), { txid: 'b2', confirmed: false }, 'mempool payment counts (0-conf)');
  assert.deepEqual(used.slice(0, 2), ['down', 'up']);
});

test('BCH invoices: BCH and PUSD direct (WizardConnect data), anything else via 1Click, freelancer told once', async () => {
  const s = setup();
  let hit = null;
  const watches = [];
  const bch = { tip: async () => 900, findPayment: async (w) => { watches.push(w); return hit && w.kind === hit.kind ? hit : null; } };
  const intents = { ...s.intents, payoutUnits: async (cents, cur, chain) => (chain === 'bch' ? '140000000' : String(Math.round(cents * (cur === 'EUR' ? 112 : 100) * 100))) }; // 392 $ at 280 $/BCH = 1.4 BCH
  const payments = createPayments({ db: s.db, intents, bch, api: s.api, cfg: s.cfg, clock: () => T0 });
  await s.msg('Factura a Marta 350 euros por el logo');
  await s.tap(s.buttons().find((b) => b.callback_data.startsWith('send:')).callback_data);
  await s.tap(s.buttons().find((b) => b.callback_data.startsWith('po:bch:')).callback_data);
  await s.msg(ZADDR);
  const inv = await s.db.invoiceById(1);
  assert.equal(inv.payout_chain, 'bch');
  assert.equal(inv.payout_address, ZADDR);

  const d = await payments.startPayment(inv, { assetId: BCH_ASSET });
  assert.equal(d.address, QADDR, 'BCH goes to the plain address');
  assert.equal(d.amountIn, '1.40000001', '1.4 BCH, tagged with invoice 1');
  assert.equal(d.direct.kind, 'bch');
  assert.equal(d.direct.sats, 140000001);
  assert.equal(readMemo(d.direct.memo), '1');
  assert.match(d.direct.uri, /^bitcoincash:qp.*\?amount=1\.40000001/);
  assert.equal((await payments.startPayment(inv, { assetId: BCH_ASSET })).key, d.key, 'one watch per invoice and asset');

  const p = await payments.startPayment(inv, { assetId: PUSD_ASSET });
  assert.equal(p.address, ZADDR, 'PUSD goes to the token-aware address');
  assert.equal(p.amountIn, '392.00', '350 € → 392.00 PUSD');
  assert.deepEqual(p.direct.token, { category: PUSD.category, amount: '39200' });

  const other = await payments.startPayment(inv, { assetId: USDC, refundTo: 'x.near' });
  assert.equal(other.address, 'DEP1', 'other tokens still go through 1Click');
  assert.equal(s.intents.st.lastQuote.recipient, ZADDR);

  assert.equal(await payments.refresh(await s.db.getDeposit(p.key)), 'PENDING_DEPOSIT');
  assert.equal(watches.at(-1).fromHeight, 900);
  hit = { kind: 'pusd', txid: 'f00d', confirmed: false };
  assert.equal(await payments.refresh(await s.db.getDeposit(p.key)), 'SUCCESS');
  assert.match(s.last().text, /Marta García te ha pagado 350,00\s€/);
  assert.match(s.last().text, /392.00 PUSD · Bitcoin Cash/);
  assert.equal(s.buttons()[0].url, 'https://blockchair.com/bitcoin-cash/transaction/f00d');
  assert.equal(s.buttons()[1].url, 'https://cobra.test/bridge', 'paid in BCH/PUSD: a button to the bridge');
  assert.equal((await s.db.invoiceById(1)).status, 'PAID');
});

test('BCH payment page offers WizardConnect BCH and PUSD first, and serves the wallet script', async () => {
  const s = setup();
  await s.msg('Factura a Marta 350 euros por el logo');
  await s.tap(s.buttons().find((b) => b.callback_data.startsWith('send:')).callback_data);
  await s.tap(s.buttons().find((b) => b.callback_data.startsWith('po:bch:')).callback_data);
  await s.msg(ZADDR);
  const inv = await s.db.invoiceById(1);
  const env = { DB: s.d1, PUBLIC_URL: 'https://cobra.test', BOT_TOKEN: 'x' };
  const deps = { intents: s.intents, api: s.api, bch: { tip: async () => 1 } };
  const page = await (await worker.fetch(new Request(`https://cobra.test/pay/${inv.pay_token}`), env, {}, deps)).text();
  const opts = JSON.parse(page.match(/const OPTIONS = (.*);/)[1]);
  assert.deepEqual(opts.slice(0, 2).map((o) => o.assetId), [BCH_ASSET, PUSD_ASSET]);
  assert.ok(opts.some((o) => o.assetId === USDC), 'and the 1Click options after them');
  const js = await worker.fetch(new Request('https://cobra.test/bch-wallet.js'), env, {}, deps);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.ok((await js.text()).length > 100_000);
});

test('home page has the BLAZE banner; /demo opens one $0.10 BCH invoice per visitor', async () => {
  const s = setup();
  const env = { DB: s.d1, PUBLIC_URL: 'https://cobra.test', BOT_TOKEN: 'x', DEMO_BCH_ADDRESS: ZADDR, PRESENTATION_URL: 'https://docs.google.com/presentation/d/x' };
  const deps = { intents: s.intents, api: s.api, bch: { tip: async () => 1 } };
  const home = await (await worker.fetch(new Request('https://cobra.test/'), env, {}, deps)).text();
  assert.match(home, /BCH BLAZE 2026/);
  assert.ok(home.includes(ZADDR) && home.includes('docs.google.com/presentation') && home.includes('/tree/ac3e0bb'));
  assert.ok(home.includes('cobra-bch') && home.includes('blaze-start...main') && home.includes('Prepared on 14 Nov'), 'old, prepared and new are told apart');
  const go = (q = '') => worker.fetch(new Request(`https://cobra.test/demo${q}`, { headers: { 'cf-connecting-ip': '1.2.3.4' } }), env, {}, deps);
  const r1 = await go();
  assert.equal(r1.status, 302);
  assert.equal((await go()).headers.get('location'), r1.headers.get('location'), 'same visitor, same open invoice');
  const inv = await s.db.invoiceByToken(new URL(r1.headers.get('location')).pathname.split('/')[2]);
  assert.equal(inv.amount_cents, 10);
  assert.equal(inv.payout_chain, 'bch');
  assert.equal(inv.payout_address, ZADDR);
  assert.notEqual((await go('?new=1')).headers.get('location'), r1.headers.get('location'));
});

// --- Stablecoin bridge (BCH BLAZE bounty): BCH ⇄ stablecoins on NEAR Intents, PUSD ⇄ BCH on Cauldron in the browser ---

import { createBridge, isChainAddress, BCH_1CLICK } from '../src/bridge.js';

const EVM = '0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c';

function bridgeIntents() {
  const calls = [];
  return {
    calls,
    tokens: async () => [
      { assetId: 'nep141:base-usdc', symbol: 'USDC', blockchain: 'base', decimals: 6 },
      { assetId: 'nep141:tron-usdt', symbol: 'USDT', blockchain: 'tron', decimals: 6 },
      { assetId: BCH_1CLICK, symbol: 'BCH', blockchain: 'bch', decimals: 8 },
    ],
    async swap(p) { calls.push(p); return { depositAddress: 'DEPO', amountInFormatted: '0.0047', amountOutFormatted: '1.00', amountOut: '1000000', timeEstimate: 109, deadline: '2026-11-14T16:00:00Z' }; },
    status: async () => ({ status: 'SUCCESS', swapDetails: { amountOutFormatted: '1.00', destinationChainTxHashes: [{ explorerUrl: 'https://basescan/tx/1' }] } }),
  };
}

test('bridge: address checks per chain', () => {
  assert.ok(isChainAddress('base', EVM));
  assert.ok(!isChainAddress('base', 'marta.near'));
  assert.ok(isChainAddress('near', 'marta.near'));
  assert.ok(isChainAddress('tron', 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf'));
  assert.ok(isChainAddress('bch', ZADDR));
  assert.ok(!isChainAddress('sol', '0x00'));
});

test('bridge: PUSD → USDC sends exact BCH sats to 1Click with a BCH refund; USDC → PUSD delivers BCH to the wallet', async () => {
  const it = bridgeIntents();
  const b = createBridge(it);
  assert.deepEqual((await b.stables()).map((s) => s.id), ['USDC-base', 'USDT-tron']);

  const out = await b.quote({ direction: 'out', stable: 'USDC-base', amount: '464585', to: EVM, refund: ZADDR });
  assert.equal(out.depositAddress, 'DEPO');
  assert.deepEqual({ ...it.calls[0], deadline: 0 }, { dry: false, originAsset: BCH_1CLICK, destinationAsset: 'nep141:base-usdc', amount: '464585', recipient: EVM, refundTo: QADDR, deadline: 0 }, 'refund to the plain BCH address');

  await b.quote({ direction: 'in', stable: 'USDT-tron', amount: '1000000', to: ZADDR, refund: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf' });
  assert.equal(it.calls[1].originAsset, 'nep141:tron-usdt');
  assert.equal(it.calls[1].destinationAsset, BCH_1CLICK);
  assert.equal(it.calls[1].recipient, QADDR, 'BCH lands on the wallet (plain form)');

  await assert.rejects(b.quote({ direction: 'out', stable: 'USDC-base', amount: '1', to: 'nope', refund: ZADDR }), /to/);
  await assert.rejects(b.quote({ direction: 'in', stable: 'USDC-base', amount: '1', to: ZADDR, refund: 'nope' }), /refund/);
  await assert.rejects(b.quote({ direction: 'out', stable: 'USDC-base', amount: '-5', to: EVM, refund: ZADDR }), /amount/);
  await assert.rejects(b.quote({ direction: 'out', stable: 'DOGE-x', amount: '5', to: EVM, refund: ZADDR }), /unknown/);
  assert.deepEqual(await b.status('DEPO'), { status: 'SUCCESS', amountOut: '1.00', txOut: 'https://basescan/tx/1', txIn: null });
});

test('bridge page and endpoints are served, with the BLAZE banner', async () => {
  const s = setup();
  const env = { DB: s.d1, PUBLIC_URL: 'https://cobra.test', BOT_TOKEN: 'x', DEMO_BCH_ADDRESS: ZADDR };
  const deps = { intents: bridgeIntents(), api: s.api, bch: { tip: async () => 1 } };
  const page = await (await worker.fetch(new Request('https://cobra.test/bridge'), env, {}, deps)).text();
  assert.match(page, /PUSD & MUSD ⇄ USDC/);
  assert.match(page, /data-t="MUSD">MUSD<small>Moria USD/, 'MUSD (Moria USD) can be picked as well as PUSD');
  assert.match(page, /id="tSw">BCH → /, 'a direct BCH → PUSD/MUSD swap tab');
  assert.match(page, /BCH BLAZE 2026/);
  assert.match(page, /USDT · Tron/);
  const js = await worker.fetch(new Request('https://cobra.test/bridge.js'), env, {}, deps);
  const bundle = await js.text();
  assert.ok(bundle.length > 500_000);
  assert.ok(bundle.includes('b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366'), 'the bundle knows the MUSD category');
  const bad = await worker.fetch(new Request('https://cobra.test/bridge/quote', { method: 'POST', body: JSON.stringify({ direction: 'out', stable: 'USDC-base', amount: '100', to: 'x', refund: ZADDR }) }), env, {}, deps);
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).detail, /destination address/);
  const ok = await worker.fetch(new Request('https://cobra.test/bridge/status?d=DEPO'), env, {}, deps);
  assert.equal((await ok.json()).status, 'SUCCESS');
});
