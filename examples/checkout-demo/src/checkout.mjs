import { createOrder } from './order.mjs';

export function checkout(cart) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return createOrder(subtotal);
}
