import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkout } from '../src/checkout.mjs';

test('charges shipping for a small order', () => {
  assert.deepEqual(checkout([{ price: 15, quantity: 2 }]), {
    subtotal: 30, shipping: 5, total: 35,
  });
});

test('waives shipping for a large order', () => {
  assert.deepEqual(checkout([{ price: 30, quantity: 3 }]), {
    subtotal: 90, shipping: 0, total: 90,
  });
});
