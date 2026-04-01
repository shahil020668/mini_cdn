/**
 * MODULE — Structured Logger
 * Outputs JSON logs compatible with Member 3's log aggregation setup.
 * Every log line includes: timestamp, level, node, message, and context fields.
 *
 * Format expected by Member 3 (DevOps):
 *   { timestamp, level, node, message, id?, status?, responseTime?, ... }
 */

const NODE_NAME = process.env.NODE_NAME || 'edge-pc2';

function log(level, message, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    node: NODE_NAME,
    message,
    ...context,
  };
  // JSON per line — easy to parse with Prometheus/Loki/Grafana
  console.log(JSON.stringify(entry));
}

const logger = {
  info:  (msg, ctx) => log('INFO',  msg, ctx),
  warn:  (msg, ctx) => log('WARN',  msg, ctx),
  error: (msg, ctx) => log('ERROR', msg, ctx),
};

module.exports = logger;
