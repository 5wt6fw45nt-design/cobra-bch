// /presentation: the BCH BLAZE «Widget Factory» presentation for Cobra, following the official template's 7 slides
// (title, tagline + repo, story, benefits, BCH usage, vision, thank you). Arrow keys, swipe or the buttons move between slides.

const REPO = 'https://github.com/5wt6fw45nt-design/cobra-bch';
const SITE = 'https://cobra-near.ancient-shape-040f.workers.dev';

export function presentationPage({ logo = '/logo.png' } = {}) {
  const slides = [
    `<div class="split"><div><h1>Cobra</h1><p class="team">Team Cadawallet (solo builder)</p>
       <p class="links">🌐 <a href="${SITE}">cobra-near…workers.dev</a> · ✈️ <a href="https://t.me/Cobrainvoicebot">@Cobrainvoicebot</a> · 𝕏 <a href="https://x.com/Cadawallet">@Cadawallet</a></p></div>
       <img class="logo" src="${logo}" alt="Cobra logo"></div>`,
    `<div class="center"><h1>Cobra<span class="red">!</span></h1><p class="big">Say who to bill. Get paid in Bitcoin Cash.</p><p><a href="${REPO}">${REPO.replace('https://', '')}</a></p></div>`,
    `<h2 class="tag">The Story of Cobra</h2><div class="split"><div class="text">
       <p>Freelancers lose hours writing invoices and chasing payments, and clients abroad often can't pay them cheaply.</p>
       <p>Cobra began as a Telegram assistant that turns a voice note into an invoice. For BLAZE we made it Bitcoin Cash native: the client pays in BCH or in PUSD, straight to the freelancer, and the money is there in seconds.</p>
       <p>Then we asked: what if the freelancer wants dollars on another chain? So we built a bridge too.</p></div>
       <div class="card"><div class="mono">🎙️ “Bill Marta 350 euros for the logo.”</div><div class="mono">🧾 Invoice #0007 · 350,00 €</div><div class="mono ok">✅ Marta paid you · 392.00 PUSD</div></div></div>`,
    `<div class="split"><div><h2>Benefits of Cobra</h2><div class="bar"></div></div><ul>
       <li>An invoice in 10 seconds, by voice or text<ul><li>English or Spanish, EUR or USD</li></ul></li>
       <li>Clients pay in BCH or PUSD from any wallet<ul><li>Paytaca, Cashonize, Zapit over WizardConnect, or any QR</li></ul></li>
       <li>Seen in seconds: Telegram alert with the transaction</li>
       <li>Non-custodial: Cobra never holds keys or funds</li>
       <li>Keep it in dollars: PUSD → USDC on 8 chains, one signature</li></ul></div>`,
    `<div class="center"><h2>BCH <span class="red">Usage</span></h2>
       <p>Invoices priced in BCH (amount tagged with the invoice id) or in PUSD, the BCH-native dollar CashToken. The page builds the transaction with a <code>cobra &lt;invoice&gt;</code> OP_RETURN and the wallet signs it over WizardConnect. Cobra watches Fulcrum (history, mempool, tokenData).</p>
       <p>Bridge: PUSD is swapped on <b>Cauldron</b> and the BCH goes straight to a <b>NEAR Intents</b> deposit, in one transaction.</p>
       <pre>Real mainnet tests (14 Nov 2026)
invoice  $0.10 → 0.00048009 BCH   tx 6763f4f4…
bridge   0.50 PUSD → 7 Cauldron pools → 0.00236462 BCH
         → NEAR Intents → 0.488 USDC on Base   tx f874dd1f…</pre></div>`,
    `<div class="split"><div><h2>The Vision for Cobra</h2><div class="bar"></div></div><ul>
       <li>Every freelancer and small shop can bill in BCH from the chat app they already use</li>
       <li>Next: recurring invoices, CashToken receipts, shared team inboxes, a point-of-sale mode<ul><li>Business: free to start; a small fee on bridged amounts and a paid plan for teams and accountants</li></ul></li>
       <li>Next priority → onboard real freelancers through BCH communities and merchants</li>
       <li>Target: 1,000 freelancers billing in BCH in 2027</li></ul></div>`,
    `<div class="center thanks"><h1>THANK YOU!</h1><p class="big">Try it now: <a href="${SITE}/demo">pay a $0.10 demo invoice</a> · <a href="${SITE}/bridge">open the bridge</a></p></div>`,
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="/logo.png"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cobra · BCH BLAZE presentation</title>
<style>
  * { box-sizing:border-box; } html,body { margin:0; height:100%; background:#000; color:#fff; font:20px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .deck { position:fixed; inset:0; display:grid; place-items:center; }
  .slide { display:none; width:min(100vw, 177.78vh); aspect-ratio:16/9; padding:4.5% 6%; position:relative; overflow:hidden;
    background: radial-gradient(120% 90% at 50% 120%, #8c0f1c 0%, #3a0609 38%, #0b0b0d 72%); }
  .slide.on { display:flex; flex-direction:column; justify-content:center; }
  .slide::after { content:'🔥'; position:absolute; right:3%; bottom:3%; font-size:2.2vmin; opacity:.85; }
  .slide::before { content:'BCH BLAZE 2026'; position:absolute; left:3%; top:3%; font-size:1.6vmin; letter-spacing:.2em; color:#ff6a6a; font-weight:700; }
  h1 { font-size:6.4vmin; margin:0 0 1vmin; } h2 { font-size:4.4vmin; margin:0 0 2vmin; }
  .tag { background:#8c0f1c; display:inline-block; padding:.6vmin 2vmin; font-size:3vmin; align-self:flex-start; }
  p, li { font-size:2.4vmin; } .big { font-size:3.6vmin; } .team { font-size:2.8vmin; font-weight:700; } .links { font-size:2vmin; }
  ul { margin:0; padding-left:3vmin; } li { margin:.7vmin 0; font-weight:700; } li li { font-weight:600; font-size:2.1vmin; }
  .split { display:grid; grid-template-columns:1fr 1.2fr; gap:5%; align-items:center; }
  .split ul { background:rgba(10,10,12,.82); padding:3vmin 3vmin 3vmin 6vmin; border-radius:1vmin; }
  .center { text-align:center; display:flex; flex-direction:column; align-items:center; }
  .bar { width:7vmin; height:1.2vmin; background:#8c0f1c; }
  .red { color:#e0213a; } a { color:#4fd1ff; }
  .logo { width:100%; max-width:34vmin; justify-self:center; border-radius:2vmin; background:#11151c; }
  .card { background:rgba(10,10,12,.85); border:2px solid #8c0f1c; border-radius:1.4vmin; padding:3vmin; display:grid; gap:2vmin; }
  .mono { font:600 2.3vmin/1.4 ui-monospace, Menlo, monospace; } .ok { color:#0ac18e; }
  .text p { margin:0 0 1.6vmin; }
  pre { background:#f2f2f2; color:#111; text-align:left; font:1.8vmin/1.5 ui-monospace, Menlo, monospace; padding:2vmin 3vmin; border-radius:.8vmin; }
  code { background:rgba(255,255,255,.12); padding:0 .6vmin; border-radius:.4vmin; }
  .thanks { justify-content:center; height:100%; } .thanks h1 { font-size:12vmin; }
  .nav { position:fixed; bottom:1.5vmin; left:50%; transform:translateX(-50%); display:flex; gap:1vmin; align-items:center; font-size:1.8vmin; color:#bbb; }
  .nav button { background:#8c0f1c; color:#fff; border:0; border-radius:.8vmin; padding:.8vmin 2vmin; font:700 1.8vmin sans-serif; cursor:pointer; }
  @media (max-aspect-ratio: 1/1) { .split { grid-template-columns:1fr; } }
</style></head>
<body><div class="deck">${slides.map((s, i) => `<section class="slide${i === 0 ? ' on' : ''}">${s}</section>`).join('')}</div>
<div class="nav"><button id="prev">‹</button><span id="pos">1 / ${slides.length}</span><button id="next">›</button></div>
<script>
const S = [...document.querySelectorAll('.slide')]; let i = 0;
const go = (n) => { S[i].classList.remove('on'); i = Math.max(0, Math.min(S.length - 1, n)); S[i].classList.add('on'); document.getElementById('pos').textContent = (i + 1) + ' / ' + S.length; };
document.getElementById('prev').onclick = () => go(i - 1); document.getElementById('next').onclick = () => go(i + 1);
addEventListener('keydown', (e) => { if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) go(i + 1); if (['ArrowLeft', 'PageUp'].includes(e.key)) go(i - 1); });
let x0 = null; addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX)); addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); x0 = null; });
</script></body></html>`;
}
