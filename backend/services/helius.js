const axios = require('axios');

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_BASE = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const HELIUS_API = `https://api.helius.xyz/v0`;

async function getTokenHolders(mintAddress) {
  try {
    let page = 1;
    let allHolders = [];

    while (true) {
      const res = await axios.post(HELIUS_BASE, {
        jsonrpc: '2.0',
        id: 'holders',
        method: 'getTokenAccounts',
        params: {
          mint: mintAddress,
          limit: 1000,
          page
        }
      });

      const accounts = res.data?.result?.token_accounts || [];
      if (accounts.length === 0) break;

      allHolders = allHolders.concat(accounts);
      if (accounts.length < 1000) break;
      page++;
    }

    // Sort by amount descending
    allHolders.sort((a, b) => Number(b.amount) - Number(a.amount));

    return {
      totalHolders: allHolders.length,
      topHolders: allHolders.slice(0, 20).map((h, i) => ({
        rank: i + 1,
        wallet: h.owner,
        amount: Number(h.amount),
        uiAmount: Number(h.amount) / 1e6
      })),
      allHolders
    };
  } catch (err) {
    console.error('Helius getTokenHolders error:', err.message);
    throw err;
  }
}

async function getTokenMetadata(mintAddress) {
  try {
    const res = await axios.get(
      `${HELIUS_API}/token-metadata?api-key=${HELIUS_API_KEY}`,
      {
        params: { mintAccounts: [mintAddress] }
      }
    );

    const token = res.data?.[0];
    if (!token) return null;

    return {
      name: token.onChainMetadata?.metadata?.data?.name || 'Unknown',
      symbol: token.onChainMetadata?.metadata?.data?.symbol || '???',
      image: token.offChainMetadata?.metadata?.image || null,
      supply: token.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.supply || '0',
      decimals: token.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.decimals || 6
    };
  } catch (err) {
    console.error('Helius getTokenMetadata error:', err.message);
    return null;
  }
}

async function getTokenPrice(mintAddress) {
  try {
    const res = await axios.get(
      `https://api.jup.ag/price/v2?ids=${mintAddress}`
    );
    const price = res.data?.data?.[mintAddress]?.price;
    return price ? Number(price) : null;
  } catch {
    return null;
  }
}

async function getBurnTransactions(mintAddress, limit = 10) {
  try {
    const res = await axios.get(
      `${HELIUS_API}/addresses/${mintAddress}/transactions?api-key=${HELIUS_API_KEY}&limit=${limit}&type=BURN`
    );
    return res.data || [];
  } catch {
    return [];
  }
}

async function subscribeWebhook(mintAddress, webhookUrl) {
  try {
    const res = await axios.post(
      `${HELIUS_API}/webhooks?api-key=${HELIUS_API_KEY}`,
      {
        webhookURL: webhookUrl,
        transactionTypes: ['TRANSFER', 'BURN'],
        accountAddresses: [mintAddress],
        webhookType: 'enhanced'
      }
    );
    return res.data?.webhookID;
  } catch (err) {
    console.error('Webhook subscribe error:', err.message);
    return null;
  }
}

module.exports = {
  getTokenHolders,
  getTokenMetadata,
  getTokenPrice,
  getBurnTransactions,
  subscribeWebhook
};
