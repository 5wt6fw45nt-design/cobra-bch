// Cobra Invoice: Cobra's invoice payment, migrated to an XO template.
//
// In Cobra (https://github.com/5wt6fw45nt-design/cobra-bch) a freelancer bills a client from Telegram and the client pays
// straight to the freelancer's own address, with an OP_RETURN "cobra" "<invoice>" memo so the payment is matched to the
// invoice. Here the same flow is an XO action:
//   issueInvoice (freelancer starts it): the freelancer fills in the amount and the invoice number, the engine derives a
//     fresh key for this invoice, and the invitation is sent to the client. The client adds coins and signs. The
//     transaction pays the freelancer and carries the memo.
//   refundInvoice (follow-up, on the paid output): the freelancer can return the payment to the refund address the client
//     gave when paying. This is the "money back" step Cobra did by hand before.

export const cobraInvoiceTemplate = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  name: 'Cobra Invoice',
  description: 'Bill a client and get paid in Bitcoin Cash: the payment goes to a fresh freelancer address with a "cobra <invoice>" memo, and can be refunded to the client later.',
  icon: 'request',
  version: '1',
  supported: ['BCH_2023_05', 'BCH_2024_05', 'BCH_2025_05', 'BCH_2026_05'],

  roles: {
    freelancer: { name: 'Freelancer', description: 'Issues the invoice and receives the payment.', icon: 'receiver' },
    client: { name: 'Client', description: 'Pays the invoice from their own wallet.', icon: 'sender' },
  },

  start: [
    { action: 'issueInvoice', role: 'freelancer', generate: ['freelancerKey'] },
  ],

  actions: {
    issueInvoice: {
      name: 'Issue Invoice',
      description: 'Bill a client: they pay the amount to you, with the invoice number written on chain.',
      icon: 'request',
      roles: {
        freelancer: {
          name: 'Bill a client',
          description: 'Ask a client to pay $(<invoiceSatoshis>) satoshis for invoice $(<invoiceNumber>).',
          icon: 'request',
          requirements: { secrets: ['freelancerKey'], variables: ['invoiceSatoshis', 'invoiceNumber'] },
        },
        client: {
          name: 'Pay invoice',
          description: 'Pay $(<invoiceSatoshis>) satoshis for invoice $(<invoiceNumber>). Your address is kept in case of a refund.',
          icon: 'send',
          requirements: { variables: ['clientRefundLockingScript'] },
        },
      },
      requirements: {
        participants: [
          { role: 'freelancer', slots: { min: 1, max: 1 } },
          { role: 'client', slots: { min: 1, max: 1 } },
        ],
      },
      transaction: 'invoicePaymentTransaction',
    },

    refundInvoice: {
      name: 'Refund Invoice',
      description: 'Send a paid invoice back to the client.',
      icon: 'send',
      roles: {
        freelancer: {
          name: 'Refund the client',
          description: 'Return $(<refundSatoshis>) satoshis of invoice $(<invoiceNumber>) to the client.',
          icon: 'send',
          requirements: { secrets: ['freelancerKey'], variables: ['refundSatoshis'] },
        },
      },
      requirements: { participants: [{ role: 'freelancer', slots: { min: 1, max: 1 } }] },
      transaction: 'refundTransaction',
    },
  },

  transactions: {
    invoicePaymentTransaction: {
      name: 'Invoice Paid',
      description: 'Invoice $(<invoiceNumber>) paid: $(<invoiceSatoshis>) satoshis.',
      icon: 'request',
      roles: {
        freelancer: { name: 'Invoice paid', description: 'Received $(<invoiceSatoshis>) satoshis for invoice $(<invoiceNumber>).', icon: 'receive' },
        client: { name: 'Invoice paid', description: 'Paid $(<invoiceSatoshis>) satoshis for invoice $(<invoiceNumber>).', icon: 'send' },
      },
      inputs: [],
      outputs: [
        { output: 'invoicePaymentOutput', outputIndex: 0 },
        { output: 'invoiceMemoOutput', outputIndex: 1 },
      ],
      version: 2,
      locktime: 0,
      composable: true,
    },
    refundTransaction: {
      name: 'Invoice Refunded',
      description: 'Refunded $(<refundSatoshis>) satoshis of invoice $(<invoiceNumber>).',
      icon: 'send',
      inputs: [{ input: 'paidInvoiceInput', inputIndex: 0 }],
      outputs: [
        { output: 'refundOutput', outputIndex: 0 },
        { output: 'refundMemoOutput', outputIndex: 1 },
      ],
      version: 2,
      locktime: 0,
      composable: true,
    },
  },

  outputs: {
    invoicePaymentOutput: {
      name: 'Invoice Payment',
      description: '$(<invoiceSatoshis>) satoshis for invoice $(<invoiceNumber>).',
      icon: 'request',
      roles: {
        freelancer: { name: 'Invoice payment received', description: 'Received $(<invoiceSatoshis>) satoshis for invoice $(<invoiceNumber>).' },
        client: { name: 'Invoice payment sent', description: 'Sent $(<invoiceSatoshis>) satoshis for invoice $(<invoiceNumber>).' },
      },
      lockingScript: 'paidInvoiceLockingScript',
      valueSatoshis: '$(<invoiceSatoshis>)',
      token: null,
    },
    invoiceMemoOutput: {
      name: 'Invoice Memo',
      description: 'On-chain note "cobra $(<invoiceNumber>)" that matches the payment to the invoice.',
      icon: 'address',
      lockingScript: 'invoiceMemoLockingScript',
      valueSatoshis: '0',
      token: null,
    },
    refundOutput: {
      name: 'Refund',
      description: '$(<refundSatoshis>) satoshis back to the client.',
      icon: 'send',
      lockingScript: 'clientRefundLockingScript',
      valueSatoshis: '$(<refundSatoshis>)',
      token: null,
    },
    refundMemoOutput: {
      name: 'Refund Memo',
      description: 'On-chain note "cobra-refund $(<invoiceNumber>)".',
      icon: 'address',
      lockingScript: 'refundMemoLockingScript',
      valueSatoshis: '0',
      token: null,
    },
  },

  inputs: {
    paidInvoiceInput: {
      name: 'Paid Invoice',
      description: 'The payment of invoice $(<invoiceNumber>).',
      icon: 'request',
      unlockingScript: 'unlockPaidInvoice',
    },
  },

  lockingScripts: {
    paidInvoiceLockingScript: {
      name: 'Paid Invoice',
      description: 'Payment of invoice $(<invoiceNumber>), held by the freelancer.',
      icon: 'address',
      lockingType: 'p2pkh',
      lockingBytecode: 'lockPaidInvoice',
      unlockingBytecode: 'unlockPaidInvoice',
      actions: [],
      roles: {
        freelancer: {
          state: { variables: ['invoiceNumber', 'invoiceSatoshis', 'clientRefundLockingScript'], secrets: ['freelancerKey'] },
          actions: [
            { action: 'refundInvoice', role: 'freelancer', secrets: [{ freelancerKey: null }] },
          ],
          balance: { satoshis: true },
          selectable: true,
        },
        client: { relevant: false },
      },
    },
    invoiceMemoLockingScript: {
      name: 'Invoice Memo',
      description: 'OP_RETURN "cobra" "<invoice>".',
      icon: 'address',
      lockingType: 'p2s',
      lockingBytecode: 'invoiceMemo',
      actions: [],
      selectable: false,
    },
    refundMemoLockingScript: {
      name: 'Refund Memo',
      description: 'OP_RETURN "cobra-refund" "<invoice>".',
      icon: 'address',
      lockingType: 'p2s',
      lockingBytecode: 'refundMemo',
      actions: [],
      selectable: false,
    },
    clientRefundLockingScript: {
      name: 'Client Refund Address',
      description: 'Where a refund of this invoice goes.',
      icon: 'address',
      lockingType: 'p2s',
      lockingBytecode: 'lockToClient',
      actions: [],
      selectable: false,
    },
  },

  variables: {
    freelancerKey: { name: 'Freelancer Key', description: 'Key for this invoice (a fresh one per invoice).', type: 'private_key' },
    invoiceSatoshis: { name: 'Amount', description: 'The invoice amount in satoshis.', type: 'satoshis' },
    invoiceNumber: { name: 'Invoice Number', description: 'The Cobra invoice number, written on chain in the memo.', type: 'string' },
    clientRefundLockingScript: { name: 'Refund Address', description: 'The client address a refund would go to.', type: 'locking_script' },
    refundSatoshis: { name: 'Refund Amount', description: 'How much to give back, in satoshis.', type: 'satoshis' },
  },

  scripts: {
    lockPaidInvoice: 'OP_DUP OP_HASH160 <$(<freelancerKey.public_key> OP_HASH160)> OP_EQUALVERIFY OP_CHECKSIG',
    unlockPaidInvoice: '<freelancerKey.schnorr_signature.all_outputs> <freelancerKey.public_key>',
    invoiceMemo: 'OP_RETURN <"cobra"> <invoiceNumber>',
    refundMemo: 'OP_RETURN <"cobra-refund"> <invoiceNumber>',
    lockToClient: '$(<clientRefundLockingScript>)',
  },
};
