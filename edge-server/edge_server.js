/**
 * EDGE SERVER — Person A (Edge Core Developer)
 * Modules: Data API, Cache Layer, Cache Logic, TTL, LRU, Purge API, Latency Simulation
 */

const express = require('express');
const redis = require('redis');
const axios = require('axios');
const { LRUTracker } = require('./lru');
const { simulateLatency } = require('./latency');
const { metrics, metricsMiddleware } = require('./metrics');
const logger = require('./logger');

const app = express();
app.use(express.json());
app.use(metricsMiddleware);

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  PORT: process.env.PORT || 4000,
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  ORIGIN_URL: process.env.ORIGIN_URL || 'http://10.49.147.94:3000', // PC1
  NODE_NAME: process.env.NODE_NAME || 'edge-pc2',
  TTL_SECONDS: 60,
  MAX_CACHE_KEYS: parseInt(process.env.MAX_CACHE_KEYS || '100'),
};

// ─── REDIS CLIENT ───────────────────────────────────────────────────────────
const redisClient = redis.createClient({ url: CONFIG.REDIS_URL });
const lru = new LRUTracker(CONFIG.MAX_CACHE_KEYS);

redisClient.on('error', (err) => logger.error('Redis error', { err: err.message }));
redisClient.on('connect', () => logger.info('Redis connected', { node: CONFIG.NODE_NAME }));

// ─── MODULE 1 & 2 & 3: DATA API + CACHE LAYER + HIT/MISS LOGIC ─────────────
/**
 * GET /data/:id
 * 1. Check Redis for cached value (cache hit)
 * 2. On miss → fetch from Origin (PC1)
 * 3. Store in Redis with TTL
 * 4. Return data with status header
 */
app.get('/data/:id', async (req, res) => {
  const { id } = req.params;
  const startTime = Date.now();

  try {
    // ── STEP 1: Check Redis Cache ────────────────────────────────────────
    const cached = await redisClient.get(`data:${id}`);

    if (cached) {
      // ✅ CACHE HIT
      await simulateLatency('hit');           // Module 7: fast (0.1s)
      lru.touch(id);                          // update LRU order
      metrics.hits++;

      const responseTime = Date.now() - startTime;
      logger.info('cache hit', { id, node: CONFIG.NODE_NAME, status: 'HIT', responseTime });

      return res.json({
        data: JSON.parse(cached),
        meta: {
          status: 'HIT',
          node: CONFIG.NODE_NAME,
          responseTime: `${responseTime}ms`,
          source: 'redis-cache',
        },
      });
    }

    // ❌ CACHE MISS — fetch from Origin
    metrics.misses++;
    logger.info('cache miss', { id, node: CONFIG.NODE_NAME, status: 'MISS' });

    // ── STEP 2: Fetch from Origin (PC1) ─────────────────────────────────
    await simulateLatency('miss');            // Module 7: slow origin fetch
    const originResponse = await axios.get(`${CONFIG.ORIGIN_URL}/api/${id}`, {
      timeout: 5000,
    });
    const originData = originResponse.data;

    // ── STEP 3 & 4: Store in Redis with TTL (60 seconds) ─────────────────
    await evictIfNeeded(id);                  // Module 5: LRU eviction check
    await redisClient.setEx(`data:${id}`, CONFIG.TTL_SECONDS, JSON.stringify(originData));
    lru.touch(id);

    const responseTime = Date.now() - startTime;
    logger.info('origin fetch complete', { id, node: CONFIG.NODE_NAME, status: 'MISS', responseTime });

    return res.json({
      data: originData,
      meta: {
        status: 'MISS',
        node: CONFIG.NODE_NAME,
        responseTime: `${responseTime}ms`,
        source: 'origin-pc1',
        cachedFor: `${CONFIG.TTL_SECONDS}s`,
      },
    });

  } catch (err) {
    metrics.errors++;

    if (err.response?.status === 404) {
      logger.warn('data not found at origin', { id, node: CONFIG.NODE_NAME });
      return res.status(404).json({ error: 'Data not found', id });
    }

    logger.error('request failed', { id, err: err.message, node: CONFIG.NODE_NAME });
    return res.status(500).json({ error: 'Internal server error', id });
  }
});

// ─── MODULE 5: LRU EVICTION ────────────────────────────────────────────────
/**
 * If cache is at max capacity, evict the least recently used key before inserting.
 */
async function evictIfNeeded(incomingId) {
  const currentSize = await redisClient.dbSize();

  if (currentSize >= CONFIG.MAX_CACHE_KEYS) {
    const lruKey = lru.evict();
    if (lruKey) {
      await redisClient.del(`data:${lruKey}`);
      metrics.evictions++;
      logger.info('LRU eviction', { evicted: lruKey, incoming: incomingId, node: CONFIG.NODE_NAME });
    }
  }
}

// ─── MODULE 6: PURGE API ───────────────────────────────────────────────────
/**
 * DELETE /cache/:id
 * Called by Traffic Manager to force-invalidate a cached key.
 */
app.delete('/cache/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await redisClient.del(`data:${id}`);
    lru.remove(id);
    metrics.purges++;

    if (deleted === 0) {
      logger.warn('purge miss — key not in cache', { id, node: CONFIG.NODE_NAME });
      return res.status(404).json({ message: 'Key not found in cache', id });
    }

    logger.info('cache purged', { id, node: CONFIG.NODE_NAME, status: 'PURGED' });
    return res.json({ message: 'Cache key purged successfully', id, node: CONFIG.NODE_NAME });

  } catch (err) {
    logger.error('purge failed', { id, err: err.message });
    return res.status(500).json({ error: 'Purge failed', id });
  }
});

// ─── NEW: PURGE FROM ORIGIN (POST) ─────────────────────────────
app.post('/purge/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await redisClient.del(`data:${id}`);
    lru.remove(id);

    metrics.purges++;

    console.log(`🔄 Purge received from Origin for ${id}`);

    res.json({ message: `Purged ${id}` });
  } catch (err) {
    res.status(500).json({ error: 'Purge failed' });
  }
});

// ─── NEW: GLOBAL PURGE ─────────────────────────────────────────
app.post('/purge/all', async (req, res) => {
  try {
    await redisClient.flushDb();
    lru.clear();

    console.log("🔥 Global purge received");

    res.json({ message: "All cache cleared" });
  } catch (err) {
    res.status(500).json({ error: 'Global purge failed' });
  }
});


// ─── METRICS ENDPOINT ──────────────────────────────────────────────────────
app.get('/metrics', (req, res) => {
  const hitRate = metrics.hits + metrics.misses === 0
    ? 0
    : ((metrics.hits / (metrics.hits + metrics.misses)) * 100).toFixed(1);

  res.json({
    node: CONFIG.NODE_NAME,
    uptime: process.uptime().toFixed(0) + 's',
    cache: {
      hits: metrics.hits,
      misses: metrics.misses,
      hitRate: `${hitRate}%`,
      evictions: metrics.evictions,
      purges: metrics.purges,
      errors: metrics.errors,
    },
    lruQueue: lru.getQueue(),
  });
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const redisAlive = await redisClient.ping().then(() => true).catch(() => false);
  res.json({
    status: redisAlive ? 'ok' : 'degraded',
    node: CONFIG.NODE_NAME,
    redis: redisAlive ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// ─── START ─────────────────────────────────────────────────────────────────
(async () => {
  await redisClient.connect();
  app.listen(CONFIG.PORT, () => {
    logger.info('Edge server started', { node: CONFIG.NODE_NAME, port: CONFIG.PORT });
    console.log(`\n🚀 Edge server [${CONFIG.NODE_NAME}] running on port ${CONFIG.PORT}`);
    console.log(`   Origin URL : ${CONFIG.ORIGIN_URL}`);
    console.log(`   Redis URL  : ${CONFIG.REDIS_URL}`);
    console.log(`   TTL        : ${CONFIG.TTL_SECONDS}s`);
    console.log(`   Max keys   : ${CONFIG.MAX_CACHE_KEYS}\n`);
  });
})();
