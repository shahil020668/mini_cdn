/**
 * MODULE 7 — Latency Simulation
 *
 * Simulates real-world CDN behaviour:
 *   - Cache HIT  → Edge-to-Client is fast  (≈ 100ms)
 *   - Cache MISS → Origin-to-Edge is slow  (≈ 500–800ms, simulating WAN latency)
 *
 * This makes "HIT vs MISS" speed difference clearly observable in demo.
 */

const LATENCY = {
  hit: {
    base: 80,          // ms
    jitter: 40,        // ± random ms added for realism
  },
  miss: {
    base: 500,         // ms — simulates network hop to origin
    jitter: 300,
  },
};

/**
 * @param {'hit' | 'miss'} type
 * @returns {Promise<void>}
 */
async function simulateLatency(type) {
  const cfg = LATENCY[type] ?? LATENCY.hit;
  const delay = cfg.base + Math.floor(Math.random() * cfg.jitter);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Returns the expected delay range for documentation / health endpoints.
 */
function getLatencyProfile() {
  return {
    hit:  `${LATENCY.hit.base}–${LATENCY.hit.base + LATENCY.hit.jitter}ms`,
    miss: `${LATENCY.miss.base}–${LATENCY.miss.base + LATENCY.miss.jitter}ms`,
  };
}

module.exports = { simulateLatency, getLatencyProfile };
