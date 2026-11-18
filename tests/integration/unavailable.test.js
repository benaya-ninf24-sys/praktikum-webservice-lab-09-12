const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TEST_ENV = 'true';
process.env.PRODUCT_SERVICE_URL = 'http://127.0.0.1:1';

const { app } = require('../../services/order-service/order-service');

test('order returns 503 when Product Service is unavailable', async t => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: 1, qty: 1 }),
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'product-service tidak tersedia, coba lagi nanti',
  });
});
