const { v4: uuidv4 } = require('uuid');

/** Generate unique order number like ORD-20260225-A3K9 */
function generateOrderNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = uuidv4().slice(0, 4).toUpperCase();
  return `ORD-${date}-${rand}`;
}

/** Generate unique referral code */
function generateReferralCode(name = '') {
  const prefix = name.slice(0, 3).toUpperCase() || 'REF';
  const rand = uuidv4().slice(0, 5).toUpperCase();
  return `${prefix}${rand}`;
}

/** Async error wrapper for express routes */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { generateOrderNumber, generateReferralCode, asyncHandler };
