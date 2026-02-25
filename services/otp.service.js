const BRAND = require('../../brand.config');

/** Generate a random N-digit OTP */
function generateOTP() {
  const len = BRAND.auth.otpLength;
  const min = Math.pow(10, len - 1);
  const max = Math.pow(10, len) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

/** Send OTP via configured provider */
async function sendOTP(phone, otp) {
  const provider = process.env.OTP_PROVIDER || 'console';

  switch (provider) {
    case 'console':
      console.log(`📲 [DEV] OTP for ${phone}: ${otp}`);
      return true;

    case 'whatsapp':
      // Integrate with WhatsApp Business API (Gupshup / Interakt / Twilio)
      // const res = await axios.post(process.env.WHATSAPP_API_URL, { phone, otp });
      console.log(`📲 [WhatsApp] Sending OTP to ${phone}`);
      return true;

    case 'sms':
      // Integrate with SMS provider
      console.log(`📲 [SMS] Sending OTP to ${phone}`);
      return true;

    default:
      console.log(`📲 [FALLBACK] OTP for ${phone}: ${otp}`);
      return true;
  }
}

module.exports = { generateOTP, sendOTP };
