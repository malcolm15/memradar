function validateAlert({ email, targetPrice, productId, honeypot }) {
  const errors = [];

  // Honeypot check
  if (honeypot && honeypot.trim() !== '') {
    return { valid: false, silent: true }; // Silent rejection — don't tell bots why
  }

  // Email validation
  if (!email || typeof email !== 'string') {
    errors.push('Email is required');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.push('Please enter a valid email address');
  } else if (email.length > 254) {
    errors.push('Email address is too long');
  }

  // Target price validation
  if (targetPrice === undefined || targetPrice === null || targetPrice === '') {
    errors.push('Target price is required');
  } else {
    const price = parseFloat(targetPrice);
    if (isNaN(price)) errors.push('Target price must be a number');
    else if (price < 1) errors.push('Target price must be at least $1');
    else if (price > 10000) errors.push('Target price must be under $10,000');
  }

  // Product ID validation
  if (!productId || typeof productId !== 'string' || productId.trim() === '') {
    errors.push('Product ID is required');
  }

  return {
    valid: errors.length === 0,
    errors,
    silent: false,
    sanitized: errors.length === 0 ? {
      email: email.trim().toLowerCase(),
      targetPrice: parseFloat(targetPrice),
      productId: productId.trim(),
    } : null,
  };
}

module.exports = { validateAlert };
