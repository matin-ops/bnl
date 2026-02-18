const rateLimitStore = new Map();
const suspiciousStore = {
  blockedByRateLimit: 0,
  blockedByBotCheck: 0,
  validationFailures: 0,
  upstreamFailures: 0,
};

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const MIN_HUMAN_FILL_MS = 2000;

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.socket?.remoteAddress || "unknown";
}

function cleanOldRateLimitEntries(now) {
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now - entry.firstSeen > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(ip);
    }
  }
}

function checkRateLimit(ip, now) {
  cleanOldRateLimitEntries(now);

  const existing = rateLimitStore.get(ip);
  if (!existing) {
    rateLimitStore.set(ip, { firstSeen: now, count: 1 });
    return false;
  }

  if (now - existing.firstSeen > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { firstSeen: now, count: 1 });
    return false;
  }

  existing.count += 1;
  rateLimitStore.set(ip, existing);
  return existing.count > RATE_LIMIT_MAX_REQUESTS;
}

function isEmailValid(email) {
  if (typeof email !== "string") {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function logEvent(level, message, metadata = {}) {
  const payload = {
    at: new Date().toISOString(),
    message,
    ...metadata,
  };

  if (level === "error") {
    console.error(payload);
    return;
  }

  if (level === "warn") {
    console.warn(payload);
    return;
  }

  console.info(payload);
}

module.exports = async function handler(req, res) {
  const now = Date.now();
  const ip = getClientIp(req);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    name,
    email,
    request,
    website = "",
    clientTimestamp,
  } = req.body || {};

  if (checkRateLimit(ip, now)) {
    suspiciousStore.blockedByRateLimit += 1;
    logEvent("warn", "Rate limit exceeded", {
      ip,
      blockedByRateLimit: suspiciousStore.blockedByRateLimit,
    });
    return res.status(429).json({ error: "Too many requests" });
  }

  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) {
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const originAllowed =
      (typeof origin === "string" && origin === allowedOrigin) ||
      (typeof referer === "string" && referer.startsWith(allowedOrigin));

    if (!originAllowed) {
      suspiciousStore.blockedByBotCheck += 1;
      logEvent("warn", "Origin/referrer check failed", {
        ip,
        origin,
        referer,
        blockedByBotCheck: suspiciousStore.blockedByBotCheck,
      });
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const createdAt = Number(clientTimestamp);
  const filledTooFast = !Number.isFinite(createdAt) || now - createdAt < MIN_HUMAN_FILL_MS;
  const honeypotTriggered = typeof website === "string" && website.trim().length > 0;
  const hasUserAgent = typeof req.headers["user-agent"] === "string" && req.headers["user-agent"].length > 0;

  if (filledTooFast || honeypotTriggered || !hasUserAgent) {
    suspiciousStore.blockedByBotCheck += 1;
    logEvent("warn", "Bot protection triggered", {
      ip,
      filledTooFast,
      honeypotTriggered,
      hasUserAgent,
      blockedByBotCheck: suspiciousStore.blockedByBotCheck,
    });
    return res.status(400).json({ error: "Invalid request" });
  }

  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    name.trim().length > 120 ||
    !isEmailValid(email) ||
    typeof request !== "string" ||
    request.trim().length < 10 ||
    request.trim().length > 5000
  ) {
    suspiciousStore.validationFailures += 1;
    logEvent("warn", "Validation failed", {
      ip,
      validationFailures: suspiciousStore.validationFailures,
    });

    return res.status(422).json({
      error: "Please provide valid name, email, and request details",
    });
  }

  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!webhookUrl || !webhookSecret) {
    logEvent("error", "Missing webhook configuration", { ip });
    return res.status(500).json({ error: "Server misconfigured" });
  }

  try {
    const upstreamResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": webhookSecret,
      },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        request: request.trim(),
        metadata: {
          ip,
          userAgent: req.headers["user-agent"],
          source: "website-contact-form",
          receivedAt: new Date(now).toISOString(),
        },
      }),
    });

    if (!upstreamResponse.ok) {
      suspiciousStore.upstreamFailures += 1;
      const upstreamBody = await upstreamResponse.text();
      logEvent("error", "n8n webhook request failed", {
        ip,
        status: upstreamResponse.status,
        upstreamFailures: suspiciousStore.upstreamFailures,
        upstreamBody,
      });
      return res.status(502).json({ error: "Upstream delivery failed" });
    }

    logEvent("info", "Contact request forwarded", { ip });
    return res.status(200).json({ ok: true });
  } catch (error) {
    suspiciousStore.upstreamFailures += 1;
    logEvent("error", "Error forwarding to n8n", {
      ip,
      upstreamFailures: suspiciousStore.upstreamFailures,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(502).json({ error: "Upstream unavailable" });
  }
};
