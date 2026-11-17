# XO feedback (Cobra, Migrate to XO)

Howdy, this text is about my experience using XO. Some of the things that I liked were: Cobra made the bill and I opened it in another wallet using JSON, no server, no account, no connection. This helps freelancers get paid easily.

You can see the outputs before you sign. First it told me: no inputs, you need 3000 sats; then: input 0 is not signed. I was guided step by step, with no confusing errors. Change included, size in bytes and estimated fee.

As the client I put my coins, my refund address and my signature. Cobra paid back 1900 sats without asking me again. It is easy to see who added something and when; every step was signed by the wallet that did it.

What I think could be improved: I had some difficulty to find the template import, which was at the bottom of the page, under "or paste JSON". You can't choose the network, you can only use mainnet, there is no chipnet option, and the bounty asks to test on chipnet. It asked me for a locking bytecode in hex, not a normal BCH address. Signing is in another tab on the left, and the button is not called "Sign", it is called "Generate unlocking bytecode". I didn't understand that at first.

What I think is missing or failed: A new wallet does not include a change address. In "Add change", the automatic mode says there is no change policy, so I had to use Manual and paste my address in hex. The transaction is not sent if you do not check "Also broadcast". When I clicked "Create transaction" with the box unchecked, the invitation became "RESULT CREATED", the transaction was not sent to the network and there was no notice.

There is no "Broadcast" button after creating it. If you forget the box, there is no clear way to broadcast it later from the page. The change has a minimum that is not shown: when refunding 2000 out of 3000 sats, it failed because the change was below 546 sats; with 1900 it worked. This is about the engine, not blaze, and it is in my README notes.

Suggestions:
It would be better if the template import was on the home screen.
It would be better to choose my address from a list, not paste hex.
It would be better to have a "Broadcast" button after creating the transaction.
A new wallet should come with change already set up, but with the option to change the details.

Steps to reproduce:

No automatic change:
1. Create a new account on blaze.xo.cash.
2. Join an invitation as a Client and add an input.
3. Press "Add change" and then "Automatic": the button turns gray and the policy notice appears.

No sending to the network:
1. Complete the transaction and sign it.
2. Leave "Also broadcast" unchecked and click "Create transaction".
3. The invitation is set to "RESULT CREATED" and the transaction does not appear on the network.

Unnecessary form:
1. Within an invitation, tap on the card of an already added input.
2. "Extend merged input" opens.
3. Click "Append extension": it gives an error.

With these changes, I would use a wallet like XO with my clients regularly.

Code, template, invitations and notes: https://github.com/5wt6fw45nt-design/cobra-bch/tree/main/xo
