import { shippingFee } from './pricing.mjs';

export function createOrder(subtotal) {
  const shipping = shippingFee(subtotal);
  return { subtotal, shipping, total: subtotal + shipping };
}
