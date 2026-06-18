/**
 * MODULE — In-memory Metrics Counter
 * Exposed at GET /metrics for Prometheus scraping (Member 3).
 */

const metrics = {
  hits: 0,
  misses: 0,
  evictions: 0,
  purges: 0,
  errors: 0,
};

/**
 * Middleware: attaches start time to each request (used for response time logging).
 */
function metricsMiddleware(req, res, next) {
  req._startTime = Date.now();
  next();
}

module.exports = { metrics, metricsMiddleware };
