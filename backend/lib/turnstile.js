// Verifies a Cloudflare Turnstile token server-side.
// Call this in the alert submission endpoint before processing the request.
// Site key (public): 0x4AAAAAADTmp79GaQVF5cAu
// Secret key: process.env.TURNSTILE_SECRET_KEY (set in .env and Vercel)
async function verifyTurnstile(token) {
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: token
    })
  });
  const data = await response.json();
  return data.success;
}

module.exports = { verifyTurnstile };
