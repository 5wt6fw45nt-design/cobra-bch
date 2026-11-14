// /bridge: PUSD ⇄ USDC/USDT on 8 chains. PUSD ⇄ BCH runs on Cauldron, signed in the user's wallet over WizardConnect;
// BCH ⇄ stablecoins runs on NEAR Intents. Selling PUSD pays the BCH straight to the 1Click deposit address, so the BCH
// side is a single signature. Cobra never holds funds or keys.

const embed = (x) => JSON.stringify(x).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const QR = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

export function bridgePage({ stables, banner = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Cobra Bridge · PUSD ⇄ USDC</title>
<meta name="description" content="Move dollars between Bitcoin Cash (PUSD) and USDC/USDT on 8 chains, signed in your own wallet.">
<script src="${QR}"></script>
<style>
  :root { --bg:#f4f6fa; --card:#fff; --ink:#0f1b2d; --soft:#5d6b82; --line:#dfe5ee; --accent:#0ac18e; --accent-ink:#04261b; --bad:#c8352b; --warn:#b26a00; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b111c; --card:#141c2b; --ink:#e9eef7; --soft:#9aa8bf; --line:#253247; --accent:#2fd39a; --accent-ink:#06261a; --bad:#ff7b70; --warn:#ffb648; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width:560px; margin:0 auto; padding:22px 16px 48px; display:grid; gap:14px; }
  h1 { font-size:30px; margin:4px 0; letter-spacing:-.4px; }
  .muted { color:var(--soft); font-size:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:18px; }
  .tabs { display:grid; grid-template-columns:1fr 1fr; gap:6px; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:5px; }
  .tabs button { margin:0; background:transparent; color:var(--ink); font-weight:700; }
  .tabs button.on { background:var(--accent); color:var(--accent-ink); }
  label { display:block; font-weight:600; margin:12px 0 6px; font-size:14px; }
  input, select { width:100%; font:inherit; color:var(--ink); background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:11px 12px; }
  button { width:100%; font:inherit; font-weight:700; border:0; border-radius:12px; padding:13px; margin-top:14px; background:var(--accent); color:var(--accent-ink); cursor:pointer; }
  button:disabled { opacity:.55; cursor:wait; }
  button.ghost { background:transparent; color:var(--ink); border:1px solid var(--line); }
  .row { display:flex; justify-content:space-between; gap:12px; font-size:14px; padding:6px 0; border-top:1px solid var(--line); }
  .row:first-child { border-top:0; }
  .row span:last-child { text-align:right; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
  .addr { font:13px/1.4 ui-monospace, Menlo, monospace; background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:10px; overflow-wrap:anywhere; }
  #qr { display:flex; justify-content:center; padding:14px; background:#fff; border-radius:12px; margin:12px 0; }
  #qr:empty { display:none; }
  .err { color:var(--bad); font-size:14px; margin-top:10px; min-height:1em; }
  .steps { display:grid; gap:6px; margin-top:12px; font-size:14px; }
  .steps div::before { content:'○ '; color:var(--soft); }
  .steps div.done::before { content:'● '; color:var(--accent); }
  .steps div.now::before { content:'◐ '; color:var(--warn); }
  .hidden { display:none !important; }
  a { color:var(--accent); }
  footer { text-align:center; color:var(--soft); font-size:12px; }
</style>
</head>
<body>
${banner}
<main>
  <section>
    <div class="muted">🧾 Cobra · stablecoin bridge</div>
    <h1>PUSD ⇄ USDC, from your own wallet</h1>
    <p class="muted">Bitcoin Cash dollars (PUSD) to USDC or USDT on 8 chains and back. The PUSD side is swapped on Cauldron and signed in Paytaca, Cashonize or Zapit over WizardConnect; the cross-chain side runs on NEAR Intents. No account, no custody.</p>
  </section>

  <div class="tabs"><button id="tOut" class="on">PUSD → USDC</button><button id="tIn">USDC → PUSD</button></div>

  <section class="card">
    <button id="connect">Connect my BCH wallet (WizardConnect)</button>
    <div id="qr"></div>
    <div class="muted hidden" id="qrHint">Scan with Paytaca, Cashonize or Zapit. <a id="qrLink">On this phone? Open my wallet app</a></div>
    <div class="hidden" id="wallet">
      <div class="row"><span class="muted">Wallet</span><span id="wAddr"></span></div>
      <div class="row"><span class="muted">Balance</span><span id="wBal"></span></div>
    </div>
  </section>

  <section class="card" id="out">
    <label for="oAmount">PUSD to send</label>
    <input id="oAmount" inputmode="decimal" placeholder="1.00">
    <label for="oStable">Receive</label>
    <select id="oStable"></select>
    <label for="oTo">Your address on that chain</label>
    <input id="oTo" autocomplete="off" spellcheck="false" placeholder="0x… / you.near / …">
    <button id="oQuote" class="ghost">Get a quote</button>
    <div class="hidden" id="oQuoteBox" style="margin-top:12px"></div>
    <button id="oGo" class="hidden">Bridge now · one signature</button>
    <div class="steps hidden" id="oSteps"><div id="os1">Sign the swap in your wallet (PUSD → BCH, sent to NEAR Intents)</div><div id="os2">BCH reaches NEAR Intents</div><div id="os3">Stablecoin delivered on the other chain</div></div>
    <div class="err" id="oErr"></div>
  </section>

  <section class="card hidden" id="in">
    <label for="iStable">Send</label>
    <select id="iStable"></select>
    <label for="iAmount">Amount</label>
    <input id="iAmount" inputmode="decimal" placeholder="1.00">
    <label for="iRefund">Your address on that chain (only for refunds)</label>
    <input id="iRefund" autocomplete="off" spellcheck="false" placeholder="0x… / you.near / …">
    <button id="iQuote">Get a deposit address</button>
    <div class="hidden" id="iDeposit" style="margin-top:12px">
      <div class="muted">Send exactly</div>
      <div style="font-size:22px;font-weight:700" id="iSend"></div>
      <div class="muted">to this address</div>
      <div class="addr" id="iAddr"></div>
      <div class="muted" id="iGet" style="margin-top:8px"></div>
    </div>
    <div class="steps hidden" id="iSteps"><div id="is1">Your stablecoin reaches NEAR Intents</div><div id="is2">BCH arrives in your wallet</div><div id="is3">Swap the BCH to PUSD (sign in your wallet)</div></div>
    <button id="iSwap" class="hidden"></button>
    <div class="err" id="iErr"></div>
  </section>

  <footer>Cobra never holds funds · Cauldron pools via the Riften indexer · NEAR Intents 1Click · <a href="/">Cobra</a></footer>
</main>
<script>
const STABLES = ${embed(stables)};
const $ = (id) => document.getElementById(id);
const MEMO = '6a05636f6272610662726964676' + '5'; // OP_RETURN "cobra" "bridge"
let lib = null, me = null;
const load = async () => (lib ||= await import('/bridge.js'));
for (const sel of ['oStable', 'iStable']) for (const s of STABLES) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.label; $(sel).append(o); }
const stable = (id) => STABLES.find((s) => s.id === id);
const showQr = (qr, uri) => { $('qr').innerHTML = ''; if (window.QRCode) new QRCode($('qr'), { text: qr, width: 230, height: 230, correctLevel: QRCode.CorrectLevel.L }); $('qrHint').classList.remove('hidden'); $('qrLink').href = uri; };
const hideQr = () => { $('qr').innerHTML = ''; $('qrHint').classList.add('hidden'); };
const bch = (sats) => (Number(sats) / 1e8).toFixed(8) + ' BCH';
const usd = (cents) => (Number(cents) / 100).toFixed(2) + ' PUSD';
const step = (prefix, n) => { for (let i = 1; i <= 3; i++) $(prefix + i).className = i < n ? 'done' : i === n ? 'now' : ''; };
const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.detail || j.error || 'That did not work'); return j; };

$('tOut').onclick = () => { $('tOut').className = 'on'; $('tIn').className = ''; $('out').classList.remove('hidden'); $('in').classList.add('hidden'); };
$('tIn').onclick = () => { $('tIn').className = 'on'; $('tOut').className = ''; $('in').classList.remove('hidden'); $('out').classList.add('hidden'); };

async function connect() {
  $('connect').disabled = true;
  try {
    const b = await (await load()).balances(showQr);
    hideQr();
    me = b.address;
    $('wallet').classList.remove('hidden'); $('connect').classList.add('hidden');
    $('wAddr').textContent = me;
    $('wBal').textContent = usd(b.pusd) + ' · ' + bch(b.sats);
    return me;
  } finally { $('connect').disabled = false; }
}
$('connect').onclick = () => connect().catch((e) => ($('oErr').textContent = e.message));

// ── PUSD → stablecoin ──
let outQuote = null;
$('oQuote').onclick = async () => {
  $('oErr').textContent = ''; $('oGo').classList.add('hidden'); $('oQuoteBox').classList.add('hidden');
  try {
    if (!me) await connect();
    const cents = Math.round(Number($('oAmount').value.replace(',', '.')) * 100);
    if (!(cents >= 10)) throw new Error('Write an amount of at least 0.10 PUSD.');
    $('oQuote').disabled = true;
    const c = await (await load()).quote('sell', cents);
    const sats = String(BigInt(c.demand) - 3000n);
    const q = await post('/bridge/quote', { direction: 'out', stable: $('oStable').value, amount: sats, to: $('oTo').value.trim(), refund: me });
    outQuote = { cents, sats, q };
    $('oQuoteBox').innerHTML = '';
    for (const [k, v] of [['You send', usd(cents)], ['Cauldron swap', bch(sats) + ' (' + c.pools + ' pool' + (c.pools > 1 ? 's' : '') + ')'], ['You receive about', q.amountOut + ' ' + q.symbolOut + ' · ' + stable($('oStable').value).label.split(' · ')[1]], ['Time', '~' + Math.max(1, Math.round(q.timeEstimate / 60)) + ' min']]) {
      const r = document.createElement('div'); r.className = 'row'; r.innerHTML = '<span class="muted"></span><span></span>'; r.children[0].textContent = k; r.children[1].textContent = v; $('oQuoteBox').append(r);
    }
    $('oQuoteBox').classList.remove('hidden'); $('oGo').classList.remove('hidden');
  } catch (e) { $('oErr').textContent = e.message; } finally { $('oQuote').disabled = false; }
};
$('oGo').onclick = async () => {
  $('oErr').textContent = ''; $('oGo').disabled = true; $('oSteps').classList.remove('hidden'); step('os', 1);
  try {
    await (await load()).sellPusd({ to: outQuote.q.depositAddress, cents: outQuote.cents, sats: outQuote.sats, memo: MEMO, prompt: 'Cobra bridge: ' + usd(outQuote.cents) + ' → ' + outQuote.q.symbolOut, onQr: showQr });
    hideQr(); step('os', 2); $('oGo').classList.add('hidden');
    follow(outQuote.q.depositAddress, 'os', (s) => s === 'SUCCESS', $('oErr'));
  } catch (e) { $('oErr').textContent = e.message; } finally { $('oGo').disabled = false; }
};

/** Follows a 1Click deposit until it settles; then(fin) when done. */
function follow(dep, prefix, isDone, errBox, then) {
  const t = setInterval(async () => {
    try {
      const s = await (await fetch('/bridge/status?d=' + encodeURIComponent(dep))).json();
      if (s.status === 'PROCESSING' || s.status === 'KNOWN_DEPOSIT_TX') step(prefix, 2);
      if (s.status === 'REFUNDED' || s.status === 'FAILED') { clearInterval(t); errBox.textContent = 'NEAR Intents refunded the payment to your address.'; }
      if (isDone(s.status)) {
        clearInterval(t); step(prefix, then ? 3 : 4);
        if (s.txOut) { const a = document.createElement('a'); a.href = s.txOut; a.target = '_blank'; a.textContent = 'See the delivery transaction'; $(prefix + '3').append(' · ', a); }
        then?.(s);
      }
    } catch {}
  }, 5000);
}

// ── stablecoin → PUSD ──
$('iQuote').onclick = async () => {
  $('iErr').textContent = '';
  try {
    if (!me) await connect();
    const s = stable($('iStable').value);
    const amount = Number($('iAmount').value.replace(',', '.'));
    if (!(amount >= 0.5)) throw new Error('Write an amount of at least 0.50.');
    $('iQuote').disabled = true;
    const units = String(Math.round(amount * 10 ** s.decimals));
    const q = await post('/bridge/quote', { direction: 'in', stable: s.id, amount: units, to: me, refund: $('iRefund').value.trim() });
    $('iSend').textContent = q.amountIn + ' ' + s.label;
    $('iAddr').textContent = q.depositAddress + (q.depositMemo ? '  memo: ' + q.depositMemo : '');
    $('iGet').textContent = 'You get about ' + q.amountOut + ' BCH in your wallet, then swap it to PUSD here with one signature.';
    $('qr').innerHTML = ''; if (window.QRCode) new QRCode($('qr'), { text: q.depositAddress, width: 200, height: 200 });
    $('iDeposit').classList.remove('hidden'); $('iSteps').classList.remove('hidden'); step('is', 1); $('iQuote').classList.add('hidden');
    follow(q.depositAddress, 'is', (st) => st === 'SUCCESS', $('iErr'), async (st) => {
      $('qr').innerHTML = '';
      const sats = BigInt(q.amountOutUnits) - 3000n;
      const c = await (await load()).quote('buy', String(sats));
      $('iSwap').textContent = 'Swap ' + bch(sats) + ' to about ' + usd(c.demand);
      $('iSwap').classList.remove('hidden');
      $('iSwap').onclick = async () => {
        $('iSwap').disabled = true; $('iErr').textContent = '';
        try {
          const r = await (await load()).buyPusd({ sats: String(sats), prompt: 'Cobra bridge: BCH → PUSD', onQr: showQr });
          hideQr(); step('is', 4); $('iSwap').classList.add('hidden'); $('is3').append(' · ' + usd(r.cents) + ' received');
        } catch (e) { $('iErr').textContent = e.message; } finally { $('iSwap').disabled = false; }
      };
    });
  } catch (e) { $('iErr').textContent = e.message; } finally { $('iQuote').disabled = false; }
};
</script>
</body>
</html>`;
}
