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

// CONFIG 
const CONFIG = {
  PORT: process.env.PORT || 3000,
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  ORIGIN_URL: process.env.ORIGIN_URL || 'http://10.17.163.94:4000',
  NODE_NAME: process.env.NODE_NAME || 'edge-pc2',
  TTL_SECONDS: 60,
  MAX_CACHE_KEYS: parseInt(process.env.MAX_CACHE_KEYS || '100'),
};

// REDIS CLIENT
const redisClient = redis.createClient({ url: CONFIG.REDIS_URL });
const lru = new LRUTracker(CONFIG.MAX_CACHE_KEYS);

redisClient.on('error', (err) => logger.error('Redis error', { err: err.message }));
redisClient.on('connect', () => logger.info('Redis connected', { node: CONFIG.NODE_NAME }));

// MAIN API 
app.get('/data/:id', async (req, res) => {
  const { id } = req.params;
  const startTime = Date.now();

  try {
    // 🔹 STEP 1: CACHE CHECK
    const cached = await redisClient.get(`data:${id}`);

    if (cached) {
      await simulateLatency('hit');
      lru.touch(id);
      metrics.hits++;

      const bufferData = Buffer.from(cached, 'base64');

      const responseTime = Date.now() - startTime;
      logger.info('cache hit', { id, node: CONFIG.NODE_NAME, status: 'HIT', responseTime });

      res.set('Content-Type', 'video/mp4');
      return res.send(bufferData);
    }

    // 🔹 CACHE MISS
    metrics.misses++;
    logger.info('cache miss', { id, node: CONFIG.NODE_NAME, status: 'MISS' });

    await simulateLatency('miss');

    // FIX: FETCH BINARY
    const originResponse = await axios.get(`${CONFIG.ORIGIN_URL}/api/${id}`, {
      responseType: 'arraybuffer',
      timeout: 5000,
    });

    const originData = originResponse.data;

    // 🔹 STORE IN REDIS (BASE64)
    const base64Data = Buffer.from(originData).toString('base64');

    await evictIfNeeded(id);
    await redisClient.setEx(`data:${id}`, CONFIG.TTL_SECONDS, base64Data);
    lru.touch(id);

    const responseTime = Date.now() - startTime;
    logger.info('origin fetch complete', { id, node: CONFIG.NODE_NAME, status: 'MISS', responseTime });

    // 🔹 SEND FILE
    res.set('Content-Type', 'video/mp4');
    return res.send(originData);

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

// LRU
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

//PURGE
app.delete('/cache/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await redisClient.del(`data:${id}`);
    lru.remove(id);
    metrics.purges++;

    if (deleted === 0) {
      return res.status(404).json({ message: 'Key not found in cache', id });
    }

    return res.json({ message: 'Cache key purged successfully', id });
  } catch {
    return res.status(500).json({ error: 'Purge failed', id });
  }
});

app.post('/purge/:id', async (req, res) => {
  const { id } = req.params;
  await redisClient.del(`data:${id}`);
  lru.remove(id);
  res.json({ message: `Purged ${id}` });
});

app.post('/purge/all', async (req, res) => {
  await redisClient.flushDb();
  lru.clear();
  res.json({ message: "All cache cleared" });
});

// METRICS
app.get('/metrics', (req, res) => {
  const hitRate = metrics.hits + metrics.misses === 0
    ? 0
    : ((metrics.hits / (metrics.hits + metrics.misses)) * 100).toFixed(1);

  res.json({
    node: CONFIG.NODE_NAME,
    cache: {
      hits: metrics.hits,
      misses: metrics.misses,
      hitRate: `${hitRate}%`,
    }
  });
});

// HEALTH
app.get('/health', async (req, res) => {
  const redisAlive = await redisClient.ping().then(() => true).catch(() => false);
  res.json({
    status: redisAlive ? 'ok' : 'degraded',
    node: CONFIG.NODE_NAME,
    redis: redisAlive ? 'connected' : 'disconnected'
  });
});

// START
(async () => {
  await redisClient.connect();

  app.listen(CONFIG.PORT, "0.0.0.0", () => {
    console.log(`Edge server running on port ${CONFIG.PORT}`);
  });
})();
