/**
 * txParser.js
 * Parses raw Helius enhanced webhook payloads into structured buy/sell events.
 */

const { graph } = require('./walletGraph');
const { recordEntry, recordExit } = require('./smartMoney');
const { pushEvent } = require('./behaviorEngine');

const DEX_PROGRAMS = {
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'RAYDIUM_V4',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'PUMP_FUN',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'JUPITER_V6',
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB': 'JUPITER_V4',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'ORCA_WHIRLPOOL',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'ORCA_V1',
  'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX': 'SERUM_V3',
};

const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

const STABLE_MINTS = new Set([WSOL, USDC, USDT]);

function parseTransaction(tx) {
  if (!tx) return [];

  const events = [];

  try {
    const dex = detectDEX(tx);
    const parsed = dex
      ? parseDEXSwap(tx, dex)
      : parseTransferFallback(tx);

    for (const event of parsed) {
      if (!event.mint || !event.wallet) continue;
      if (STABLE_MINTS.has(event.mint)) continue;

      pushEvent(event.mint, event);

      if (event.counterparty) {
        graph.addTransaction({
          from: event.type === 'buy' ? event.counterparty : event.wallet,
          to: event.type === 'buy' ? event.wallet : event.counterparty,
          mint: event.mint,
          amount: event.amount,
          timestamp: event.timestamp,
        });
      }

      if (event.type === 'buy') {
        recordEntry(event.wallet, {
          mint: event.mint,
          timestamp: event.timestamp,
          price: event.priceUsd || null,
          holderCountAtEntry: event.holderCountAtEntry || null,
        });
      } else if (event.type === 'sell') {
        recordExit(event.wallet, {
          mint: event.mint,
          timestamp: event.timestamp,
          price: event.priceUsd || null,
          entryPrice: null,
        });
      }

      events.push(event);
    }
  } catch (e) {
    console.error('[txParser] Error parsing tx:', e.message);
  }

  return events;
}

function detectDEX(tx) {
  const accountKeys = tx.accountData?.map(a => a.account) || [];
  const instructions = tx.instructions || [];

  for (const ix of instructions) {
    if (DEX_PROGRAMS[ix.programId]) return DEX_PROGRAMS[ix.programId];
    for (const inner of (ix.innerInstructions || [])) {
      if (DEX_PROGRAMS[inner.programId]) return DEX_PROGRAMS[inner.programId];
    }
  }

  for (const account of accountKeys) {
    if (DEX_PROGRAMS[account]) return DEX_PROGRAMS[account];
  }

  return null;
}

function parseDEXSwap(tx, dex) {
  const events = [];
  const timestamp = (tx.timestamp || Math.floor(Date.now() / 1000)) * 1000;
  const signer = tx.feePayer || tx.accountData?.[0]?.account;

  const transfers = tx.tokenTransfers || [];
  const nativeTransfers = tx.nativeTransfers || [];

  if (!transfers.length) return parseTransferFallback(tx);

  const received = transfers.filter(t =>
    t.toUserAccount === signer && !STABLE_MINTS.has(t.mint)
  );
  const sent = transfers.filter(t =>
    t.fromUserAccount === signer && !STABLE_MINTS.has(t.mint)
  );

  const solMoved = nativeTransfers.reduce((sum, t) => {
    if (t.fromUserAccount === signer) return sum + (t.amount || 0);
    return sum;
  }, 0);
  const solValue = solMoved / 1e9;

  for (const transfer of received) {
    events.push({
      type: 'buy',
      wallet: signer,
      mint: transfer.mint,
      amount: Number(transfer.tokenAmount) || 0,
      solValue,
      dex,
      timestamp,
      signature: tx.signature,
      counterparty: transfer.fromUserAccount,
    });
  }

  for (const transfer of sent) {
    events.push({
      type: 'sell',
      wallet: signer,
      mint: transfer.mint,
      amount: Number(transfer.tokenAmount) || 0,
      solValue,
      dex,
      timestamp,
      signature: tx.signature,
      counterparty: transfer.toUserAccount,
    });
  }

  if (dex === 'PUMP_FUN') {
    const pumpEvents = parsePumpFun(tx, timestamp, signer);
    events.push(...pumpEvents);
  }

  return events;
}

function parsePumpFun(tx, timestamp, signer) {
  const events = [];
  const transfers = tx.tokenTransfers || [];
  const PUMP_BONDING_CURVE_SUFFIX = 'pump';

  for (const t of transfers) {
    if (STABLE_MINTS.has(t.mint)) continue;

    const fromIsBonding = t.fromUserAccount?.endsWith(PUMP_BONDING_CURVE_SUFFIX);
    const toIsBonding = t.toUserAccount?.endsWith(PUMP_BONDING_CURVE_SUFFIX);

    if (fromIsBonding && t.toUserAccount !== signer) {
      events.push({
        type: 'buy',
        wallet: t.toUserAccount,
        mint: t.mint,
        amount: Number(t.tokenAmount) || 0,
        dex: 'PUMP_FUN',
        timestamp,
        signature: tx.signature,
        counterparty: t.fromUserAccount,
      });
    } else if (toIsBonding && t.fromUserAccount !== signer) {
      events.push({
        type: 'sell',
        wallet: t.fromUserAccount,
        mint: t.mint,
        amount: Number(t.tokenAmount) || 0,
        dex: 'PUMP_FUN',
        timestamp,
        signature: tx.signature,
        counterparty: t.toUserAccount,
      });
    }
  }

  return events;
}

function parseTransferFallback(tx) {
  const events = [];
  const timestamp = (tx.timestamp || Math.floor(Date.now() / 1000)) * 1000;
  const transfers = tx.tokenTransfers || [];

  for (const t of transfers) {
    if (!t.mint || STABLE_MINTS.has(t.mint)) continue;
    if (!t.fromUserAccount || !t.toUserAccount) continue;

    const amount = Number(t.tokenAmount) || 0;
    if (amount <= 0) continue;

    events.push({
      type: 'transfer',
      wallet: t.fromUserAccount,
      mint: t.mint,
      amount,
      timestamp,
      signature: tx.signature,
      counterparty: t.toUserAccount,
      isWhale: amount > 1_000_000,
    });

    events.push({
      type: 'receive',
      wallet: t.toUserAccount,
      mint: t.mint,
      amount,
      timestamp,
      signature: tx.signature,
      counterparty: t.fromUserAccount,
    });
  }

  return events;
}

function parseTransactions(txArray) {
  if (!Array.isArray(txArray)) return parseTransaction(txArray);
  const all = [];
  for (const tx of txArray) {
    all.push(...parseTransaction(tx));
  }
  return all;
}

module.exports = { parseTransaction, parseTransactions, detectDEX };
