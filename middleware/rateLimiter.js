const rateLimit = require('express-rate-limit');
const BRAND = require('../../brand.config');

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: BRAND.auth.otpRateLimitPerHour,
  keyGenerator: (req) => req.body.phone || req.ip,
  message: { success: false, message: `Too many OTP requests. Max ${BRAND.auth.otpRateLimitPerHour}/hour` },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, slow down' },
});

const guestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many requests' },
});

module.exports = { otpLimiter, apiLimiter, guestLimiter };
