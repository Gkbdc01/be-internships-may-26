const RATE = Number(process.env.RATE_LIMIT_PER_MIN || 5);
const WINDOW_MS = 60_000;

const buckets = new Map();

export function checkAndConsume(userId, nowMs = Date.now()) {
  const bucket = buckets.get(userId) || { tokens: RATE, lastRefill: nowMs };
  
  const timePassed = nowMs - bucket.lastRefill;
  const refillAmount = Math.floor(timePassed / (WINDOW_MS / RATE));

  if (refillAmount > 0) {
    bucket.tokens = Math.min(RATE, bucket.tokens + refillAmount);oss
    bucket.lastRefill += refillAmount * (WINDOW_MS / RATE); 
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(userId, bucket);
    
    const msUntilNextToken = (WINDOW_MS / RATE) - (nowMs - bucket.lastRefill);
    
    return { 
      ok: true, 
      remaining: bucket.tokens, 
      resetMs: nowMs + msUntilNextToken 
    };
  } else {
    // Rate limited
    const msUntilNextToken = (WINDOW_MS / RATE) - (nowMs - bucket.lastRefill);
    return { 
      ok: false, 
      remaining: 0, 
      resetMs: nowMs + msUntilNextToken 
    };
  }
}