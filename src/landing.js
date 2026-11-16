// Home page (BCH BLAZE 2026): the banner the rules ask for (presentation, repo, CashTokens donation address,
// what existed before the hackathon) and a one-click demo invoice that anyone can pay in BCH or PUSD on mainnet.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const REPO = 'https://github.com/5wt6fw45nt-design/cobra-bch'; // fork made at BLAZE kick-off
export const OLD_REPO = 'https://github.com/5wt6fw45nt-design/cobra-near'; // Cobra before BLAZE
export const PRE_BLAZE_COMMIT = 'ac3e0bb'; // Cobra before BLAZE (10 Nov 2026)
export const BLAZE_START = 'blaze-start'; // 8903fee: BCH work prepared on 14 Nov before the kick-off
export const PRE_BLAZE_DEMO = 'https://x.com/Cadawallet/status/2117644899109761343';

/** The banner BLAZE asks for at the top of every demo page (self-contained styles, so any page can include it). */
export function blazeBanner({ presentation, donate }) {
  return `<style>
  .blz { background:#0f1b2d; color:#e9eef7; padding:10px 16px; font:14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  @media (prefers-color-scheme: dark) { .blz { background:#0ac18e; color:#04261b; } }
  .blz .in { max-width:880px; margin:0 auto; display:flex; flex-wrap:wrap; gap:6px 18px; align-items:center; }
  .blz a { color:inherit; font-weight:700; } .blz code { font:12px/1.3 ui-monospace, Menlo, monospace; overflow-wrap:anywhere; }
</style>
<div class="blz"><div class="in">
  <span>🔥 BCH BLAZE 2026</span>
  ${presentation ? `<a href="${esc(presentation)}" target="_blank" rel="noopener">Presentation</a>` : ''}
  <a href="${REPO}" target="_blank" rel="noopener">New repo (cobra-bch)</a>
  <a href="${OLD_REPO}/tree/${PRE_BLAZE_COMMIT}" target="_blank" rel="noopener">Old repo (before BLAZE)</a>
  <a href="${PRE_BLAZE_DEMO}" target="_blank" rel="noopener">Demo before BLAZE</a>
  <a href="${REPO}/compare/${BLAZE_START}...main" target="_blank" rel="noopener">What's new during BLAZE</a>
  ${donate ? `<span>EMBER2026 / donations: <code>${esc(donate)}</code></span>` : ''}
</div></div>`;
}

export function landingPage({ presentation, donate, bot = 'Cobrainvoicebot' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><link rel="icon" href="/logo.png">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Cobra · voice-to-invoice, paid in Bitcoin Cash</title>
<meta name="description" content="Tell a Telegram bot who to bill; your client pays in BCH or PUSD from any wallet over WizardConnect.">
<style>
  :root { --bg:#f4f6fa; --card:#fff; --ink:#0f1b2d; --soft:#5d6b82; --line:#dfe5ee; --accent:#0ac18e; --accent-ink:#04261b; --banner:#0f1b2d; --banner-ink:#e9eef7; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b111c; --card:#141c2b; --ink:#e9eef7; --soft:#9aa8bf; --line:#253247; --banner:#0ac18e; --banner-ink:#04261b; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .banner { background:var(--banner); color:var(--banner-ink); padding:10px 16px; font-size:14px; }
  .banner .in { max-width:880px; margin:0 auto; display:flex; flex-wrap:wrap; gap:6px 18px; align-items:center; }
  .banner a { color:inherit; font-weight:700; }
  .banner code { font:12px/1.3 ui-monospace, Menlo, monospace; overflow-wrap:anywhere; }
  main { max-width:880px; margin:0 auto; padding:28px 16px 48px; display:grid; gap:18px; }
  h1 { font-size:38px; line-height:1.1; margin:6px 0; letter-spacing:-.5px; }
  .lead { font-size:19px; color:var(--soft); margin:0; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:20px; }
  .cta { display:inline-block; background:var(--accent); color:var(--accent-ink); font-weight:800; text-decoration:none; border-radius:12px; padding:14px 20px; font-size:17px; }
  .ghost { display:inline-block; color:var(--ink); border:1px solid var(--line); border-radius:12px; padding:13px 18px; text-decoration:none; font-weight:600; margin-left:8px; }
  .steps { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; }
  .steps div { background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:14px; }
  .steps b { display:block; margin-bottom:4px; }
  h2 { font-size:20px; margin:0 0 10px; }
  ul { margin:0; padding-left:20px; } li { margin:4px 0; }
  .muted { color:var(--soft); font-size:14px; }
  a { color:var(--accent); }
</style>
</head>
<body>
${blazeBanner({ presentation, donate })}
<main>
  <section>
    <div class="muted" style="display:flex;align-items:center;gap:10px"><img src="/logo.png" alt="Cobra" width="44" height="44" style="border-radius:11px"> Cobra · Telegram assistant for freelancers</div>
    <h1>Say who to bill. Get paid in Bitcoin Cash.</h1>
    <p class="lead">Send Cobra a voice note: “Bill Marta 350 euros for the logo.” It writes the invoice and gives you a payment link. Your client pays in <b>BCH</b> or in <b>PUSD</b> (ParyonUSD) from Paytaca, Cashonize or Zapit over <b>WizardConnect</b>, straight to your address. Cobra tells you the moment it lands.</p>
  </section>

  <section class="card">
    <h2>Try it now: pay a $0.10 invoice on mainnet</h2>
    <p class="muted">Opens a real Cobra invoice. Tap <b>Pay with my wallet (WizardConnect)</b>, scan the QR with Paytaca, Cashonize or Zapit and approve. Or scan the BIP21 QR with any BCH wallet. The page turns green as soon as the payment is seen (0-conf).</p>
    <a class="cta" href="/demo">Pay a demo invoice</a>
    <a class="ghost" href="https://t.me/${esc(bot)}" target="_blank" rel="noopener">Make your own invoice on Telegram</a>
  </section>

  <section class="card">
    <h2>New: stablecoin bridge</h2>
    <p class="muted">Turn PUSD into USDC or USDT on 8 chains (Base, Arbitrum, Ethereum, Solana, Polygon, BNB Chain, NEAR, Tron) with one signature in your BCH wallet, or bring USDC in and swap it to PUSD. Cauldron for PUSD ⇄ BCH, NEAR Intents across chains, WizardConnect for signing.</p>
    <a class="cta" href="/bridge">Open the bridge</a>
  </section>

  <section class="steps">
    <div><b>1 · Talk</b>A voice note or a text in English or Spanish. Whisper and Llama (Workers AI) turn it into an invoice draft.</div>
    <div><b>2 · Share</b>One tap sends the client a payment link. EUR or USD, priced in BCH or PUSD at the moment they pay.</div>
    <div><b>3 · Pay</b>The page builds the transaction (payment + <code>cobra &lt;invoice&gt;</code> OP_RETURN); the client's wallet only signs.</div>
    <div><b>4 · Get told</b>Cobra watches your address through public Fulcrum servers and alerts you on Telegram with the transaction.</div>
  </section>

  <section class="card">
    <h2>What is old, what is new</h2>
    <ul>
      <li><b>Before BLAZE</b> (<a href="${OLD_REPO}/tree/${PRE_BLAZE_COMMIT}">code</a>, <a href="${PRE_BLAZE_DEMO}">demo</a>): voice notes become invoices on Telegram; payouts through NEAR Intents, Mezo, Concordium and Lightning.</li>
      <li><b>Prepared on 14 Nov, before the kick-off</b> (<a href="${REPO}/tree/${BLAZE_START}">blaze-start</a>, disclosed in <a href="${REPO}/tree/main/Preparation">Preparation</a>): first version of direct BCH and PUSD payments over WizardConnect, Fulcrum watching, this page and the demo invoice.</li>
      <li><b>Built during BLAZE</b>: every commit after the kick-off, listed in <a href="${REPO}/compare/${BLAZE_START}...main">this comparison</a>.</li>
    </ul>
  </section>

  <p class="muted">Non-custodial: Cobra never holds keys or funds. Open source, MIT.</p>
</main>
</body>
</html>`;
}
