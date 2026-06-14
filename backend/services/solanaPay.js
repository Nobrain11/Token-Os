const { Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');

// Generate a unique reference public key for tracking a payment
function generateReference() {
  return Keypair.generate().publicKey.toBase58();
}

// Build a Solana Pay transfer URL
// Spec: solana:<recipient>?amount=<amount>&reference=<ref>&label=<label>&message=<message>
function buildPaymentUrl({ recipient, amount, reference, label, message }) {
  const params = new URLSearchParams();
  params.append('amount', amount.toString());
  params.append('reference', reference);
  if (label) params.append('label', label);
  if (message) params.append('message', message);
  return `solana:${recipient}?${params.toString()}`;
}

// Check on-chain whether a payment with this reference has landed
async function verifyPayment(connection, referenceBase58, recipientAddress, expectedAmountSol) {
  const referencePubkey = new PublicKey(referenceBase58);

  const sigs = await connection.getSignaturesForAddress(referencePubkey, { limit: 5 });
  if (!sigs.length) return { confirmed: false };

  for (const sigInfo of sigs) {
    if (sigInfo.err) continue;

    const tx = await connection.getParsedTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0
    });
    if (!tx) continue;

    const instructions = tx.transaction.message.instructions;

    for (const ix of instructions) {
      if (ix.program === 'system' && ix.parsed?.type === 'transfer') {
        const info = ix.parsed.info;
        if (info.destination === recipientAddress) {
          const amountSol = info.lamports / LAMPORTS_PER_SOL;
          // Allow tiny tolerance for rounding
          if (amountSol >= expectedAmountSol * 0.99) {
            return { confirmed: true, signature: sigInfo.signature, amountSol };
          }
        }
      }
    }
  }

  return { confirmed: false };
}

module.exports = { generateReference, buildPaymentUrl, verifyPayment };
