/**
 * walletGraph.js
 * Builds and maintains a live wallet relationship graph.
 */

const TIME_DECAY_HALF_LIFE_MS = 24 * 60 * 60 * 1000;

class WalletGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
  }

  addTransaction({ from, to, mint, amount, timestamp }) {
    const ts = timestamp || Date.now();
    this._upsertNode(from, mint, amount, ts);
    this._upsertNode(to, mint, amount, ts);
    this._upsertEdge(from, to, amount, ts);
  }

  _upsertNode(wallet, mint, amount, ts) {
    if (!wallet) return;
    if (!this.nodes.has(wallet)) {
      this.nodes.set(wallet, {
        wallet,
        firstSeen: ts,
        lastSeen: ts,
        totalVolume: 0,
        txCount: 0,
        tokens: new Set()
      });
    }
    const node = this.nodes.get(wallet);
    node.lastSeen = Math.max(node.lastSeen, ts);
    node.totalVolume += Number(amount) || 0;
    node.txCount += 1;
    if (mint) node.tokens.add(mint);
  }

  _upsertEdge(from, to, amount, ts) {
    if (!from || !to || from === to) return;
    const key = [from, to].sort().join('|');
    if (!this.edges.has(key)) {
      this.edges.set(key, {
        from, to, interactions: 0,
        totalVolume: 0, lastSeen: ts,
        timestamps: []
      });
    }
    const edge = this.edges.get(key);
    edge.interactions += 1;
    edge.totalVolume += Number(amount) || 0;
    edge.lastSeen = Math.max(edge.lastSeen, ts);
    edge.timestamps.push(ts);
    if (edge.timestamps.length > 100) edge.timestamps.shift();
  }

  edgeWeight(key, now = Date.now()) {
    const edge = this.edges.get(key);
    if (!edge) return 0;
    const age = now - edge.lastSeen;
    const decay = Math.pow(0.5, age / TIME_DECAY_HALF_LIFE_MS);
    return (edge.interactions * Math.log1p(edge.totalVolume / 1e6)) * decay;
  }

  getNeighbours(wallet, now = Date.now()) {
    const result = [];
    for (const [key, edge] of this.edges) {
      if (edge.from !== wallet && edge.to !== wallet) continue;
      const peer = edge.from === wallet ? edge.to : edge.from;
      result.push({ peer, weight: this.edgeWeight(key, now), edge });
    }
    return result.sort((a, b) => b.weight - a.weight);
  }

  getClusters(minWeight = 0.5) {
    const visited = new Set();
    const clusters = [];

    const bfs = (start) => {
      const cluster = new Set([start]);
      const queue = [start];
      while (queue.length) {
        const w = queue.shift();
        for (const { peer, weight } of this.getNeighbours(w)) {
          if (!visited.has(peer) && weight >= minWeight) {
            visited.add(peer);
            cluster.add(peer);
            queue.push(peer);
          }
        }
      }
      return cluster;
    };

    for (const wallet of this.nodes.keys()) {
      if (!visited.has(wallet)) {
        visited.add(wallet);
        const cluster = bfs(wallet);
        if (cluster.size >= 2) clusters.push([...cluster]);
      }
    }

    return clusters.sort((a, b) => b.length - a.length);
  }

  getTokenWallets(mint) {
    const result = [];
    for (const node of this.nodes.values()) {
      if (node.tokens.has(mint)) result.push(node);
    }
    return result;
  }

  stats() {
    return {
      nodes: this.nodes.size,
      edges: this.edges.size,
      clusters: this.getClusters().length
    };
  }
}

const graph = new WalletGraph();
module.exports = { WalletGraph, graph };
