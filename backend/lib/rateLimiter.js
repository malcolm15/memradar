// In-memory rate limiter for alert submissions.
// Usage: import rateLimit from lib/rateLimiter.js and call rateLimit(ip) before
// processing an alert submission. Returns false if the limit is exceeded.
//
// TODO: Replace with a Redis-based solution (e.g. Upstash) before scaling to
// multiple Vercel serverless function instances — in-memory state is not shared
// across instances and resets on cold starts.

const requests = new Map();

function rateLimit(ip, maxRequests = 3, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const windowStart = now - windowMs;

  if (!requests.has(ip)) {
    requests.set(ip, []);
  }

  const timestamps = requests.get(ip).filter(t => t > windowStart);

  if (timestamps.length >= maxRequests) {
    return false; // Rate limit exceeded
  }

  timestamps.push(now);
  requests.set(ip, timestamps);
  return true; // Request allowed
}

module.exports = { rateLimit };
