import { shippingFee } from './pricing.mjs';

const quoteHandlers = { shipping: shippingFee };

export function quoteByName(name, subtotal) {
  return quoteHandlers[name](subtotal);
}
