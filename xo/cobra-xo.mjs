// Cobra on XO, command line. Two local XO wallets: "freelancer" (Cobra's side) and "client" (a test payer).
//   node cobra-xo.mjs address <freelancer|client>        receive address of a wallet (fund it from a chipnet faucet)
//   node cobra-xo.mjs balance <freelancer|client>
//   node cobra-xo.mjs issue <satoshis> <invoiceNumber>    freelancer bills: writes invitations/invoice-<n>.json
//   node cobra-xo.mjs pay <invitation.json>               the test client pays it (or open the file in blaze.xo.cash)
//   node cobra-xo.mjs watch <invitation.json>             freelancer picks up a payment made elsewhere (e.g. blaze.xo.cash)
//   node cobra-xo.mjs refund <paid-invitation.json> <satoshis>   follow-up action: freelancer refunds the client
// Network: chipnet by default; XO_NETWORK=mainnet to use real BCH (tiny amounts only).

import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';
import { p2pkhTemplate } from '@xo-cash/templates';
import { serializeInvitation, deserializeInvitation } from '@xo-cash/utils';
import { generateBip39Mnemonic, lockingBytecodeToCashAddress, hexToBin, binToHex } from '@bitauth/libauth';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { cobraInvoiceTemplate } from './template/cobra-invoice.mjs';

const NETWORK = process.env.XO_NETWORK === 'mainnet' ? 'mainnet' : 'chipnet';
const PREFIX = NETWORK === 'mainnet' ? 'bitcoincash' : 'bchtest';
const WALLETS = './.wallets.json'; // test mnemonics only, never real funds (git-ignored)
mkdirSync('./.db', { recursive: true });
mkdirSync('./invitations', { recursive: true });

const json = (x) => JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? binToHex(v) : v), 2);

function mnemonic(who) {
  const w = existsSync(WALLETS) ? JSON.parse(readFileSync(WALLETS, 'utf8')) : {};
  if (!w[who]) { w[who] = generateBip39Mnemonic(); writeFileSync(WALLETS, JSON.stringify(w, null, 2)); }
  return w[who];
}

async function open(who) {
  const engine = await Engine.create(mnemonic(who), {
    network: XO_SUPPORTED_NETWORKS[NETWORK], storageType: 'indexeddb', databasePath: './.db/', databaseFilename: `${who}-${NETWORK}`,
  });
  const { templateIdentifier: wallet } = await engine.importTemplate(p2pkhTemplate);
  await engine.setDefaultPolicies({ change: { templateIdentifier: wallet }, receive: { templateIdentifier: wallet }, address: { templateIdentifier: wallet } });
  const { templateIdentifier } = await engine.importTemplate(cobraInvoiceTemplate);
  return { engine, templateIdentifier };
}

const address = async (engine) => lockingBytecodeToCashAddress({ bytecode: hexToBin(await engine.generateLockingBytecodeFromDefaultPolicy('receive')), prefix: PREFIX }).address;
const sats = (list) => list.reduce((s, u) => s + BigInt(u.valueSatoshis ?? u.output?.valueSatoshis ?? 0), 0n);
const save = (name, invitation) => { const f = `./invitations/${name}.json`; writeFileSync(f, serializeInvitation(invitation)); return f; };

const [cmd, a, b] = process.argv.slice(2);
const who = ['address', 'balance'].includes(cmd) ? a : ['pay'].includes(cmd) ? 'client' : 'freelancer';
const { engine, templateIdentifier } = await open(who);
try {
  if (cmd === 'address') console.log(await address(engine));

  else if (cmd === 'balance') {
    const u = await engine.listSpendableUnspentOutputs();
    console.log(`${who}: ${u.length} coins, ${sats(u)} sats`);
  }

  else if (cmd === 'issue') {
    const stored = await engine.createInvitation({
      templateIdentifier, actionIdentifier: 'issueInvoice', intent: cobraInvoiceTemplate.start[0],
      variables: [
        { variableIdentifier: 'invoiceSatoshis', roleIdentifier: 'freelancer', value: BigInt(a) },
        { variableIdentifier: 'invoiceNumber', roleIdentifier: 'freelancer', value: String(b) },
      ],
    });
    const id = stored.invitation.invitationIdentifier;
    const done = await engine.appendInvitation(id, { templateIdentifier, actionIdentifier: 'issueInvoice', outputs: [{ outputIdentifier: 'invoicePaymentOutput' }, { outputIdentifier: 'invoiceMemoOutput' }] });
    console.log('invoice', b, 'for', a, 'sats ->', save(`invoice-${b}`, done.invitation));
    console.log('missing:', json(await engine.listMissingRequirements(id)));
  }

  else if (cmd === 'pay') {
    const received = deserializeInvitation(readFileSync(a, 'utf8'));
    const stored = await engine.acceptInvitation(received, { roleIdentifier: 'client' });
    const id = stored.invitation.invitationIdentifier;
    const refundTo = await engine.generateLockingBytecodeFromDefaultPolicy('receive');
    await engine.appendInvitation(id, { templateIdentifier, actionIdentifier: 'issueInvoice', roleIdentifier: 'client',
      variables: [{ variableIdentifier: 'clientRefundLockingScript', roleIdentifier: 'client', value: refundTo }] }); // locking_script variables are hex strings in invitations
    const coins = await engine.listSpendableUnspentOutputs();
    if (!coins.length) throw new Error('client wallet is empty: fund ' + await address(engine));
    await engine.appendInvitation(id, { templateIdentifier, actionIdentifier: 'issueInvoice', roleIdentifier: 'client',
      inputs: coins.map((u) => ({ outpointTransactionHash: hexToBin(u.outpointTransactionHash), outpointIndex: u.outpointIndex })) });
    await engine.addChangeToInvitation(id);
    for (const i of await engine.listOwnInputIndexes(id)) await engine.signInvitation(id, i);
    const { builtTransaction, storedInvitation } = await engine.executeAction(id, { broadcastTransaction: true });
    console.log('paid:', json(builtTransaction).slice(0, 400));
    console.log('->', save(`invoice-paid-${id.slice(0, 8)}`, storedInvitation.invitation));
  }

  else if (cmd === 'watch') {
    const received = deserializeInvitation(readFileSync(a, 'utf8'));
    await engine.updateInvitation(received);
    await new Promise((r) => setTimeout(r, 4000)); // let the engine fetch the payment from Electrum
    const paid = await engine.listUnspentOutputs({ templateIdentifier });
    console.log('paid invoices held by the freelancer:', json(paid).slice(0, 2500));
  }

  else if (cmd === 'refund') {
    // The paid invitation says which coin paid the invoice and where the client wants a refund.
    const received = deserializeInvitation(readFileSync(a, 'utf8'));
    await engine.updateInvitation(received).catch(() => {});
    const vars = Object.fromEntries(received.commits.flatMap((c) => c.data?.variables || []).map((v) => [v.variableIdentifier, v.value]));
    await new Promise((r) => setTimeout(r, 4000));
    // Every coin this template holds for the freelancer is a paid invoice (the memo outputs are not spendable).
    const paid = (await engine.listUnspentOutputs({ templateIdentifier })).filter((u) => BigInt(u.valueSatoshis) === BigInt(vars.invoiceSatoshis) && !u.reservedBy);
    if (!paid.length) throw new Error('no paid invoice held by the freelancer yet (run watch first)');
    const u = paid[0];
    console.log('refunding', json(u).slice(0, 600));
    const stored = await engine.createInvitation({
      templateIdentifier, actionIdentifier: 'refundInvoice', roleIdentifier: 'freelancer',
      variables: [
        { variableIdentifier: 'refundSatoshis', roleIdentifier: 'freelancer', value: BigInt(b) },
        { variableIdentifier: 'invoiceNumber', roleIdentifier: 'freelancer', value: String(vars.invoiceNumber) },
        { variableIdentifier: 'clientRefundLockingScript', roleIdentifier: 'freelancer', value: String(vars.clientRefundLockingScript) },
      ],
      inputs: [{ outpointTransactionHash: hexToBin(u.outpointTransactionHash), outpointIndex: u.outpointIndex, inputIdentifier: 'paidInvoiceInput' }],
    });
    const id = stored.invitation.invitationIdentifier;
    try {
      await engine.appendInvitation(id, { templateIdentifier, actionIdentifier: 'refundInvoice', outputs: [{ outputIdentifier: 'refundOutput' }, { outputIdentifier: 'refundMemoOutput' }] });
      await engine.addChangeToInvitation(id);
      for (const i of await engine.listOwnInputIndexes(id)) await engine.signInvitation(id, i);
      const { storedInvitation } = await engine.executeAction(id, { broadcastTransaction: true });
      console.log('refunded ->', save(`refund-${vars.invoiceNumber}`, storedInvitation.invitation));
    } catch (e) { await engine.archiveInvitation(id); throw e; } // free the paid coin for another try
  }

  else if (cmd === 'archive') { await engine.archiveInvitation(a); console.log('archived', a); }

  else console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(0, 9).join('\n'));
} catch (e) {
  console.error('ERROR', e?.name, e?.message);
  process.exitCode = 1;
} finally {
  await engine.stop();
  process.exit(process.exitCode || 0);
}
