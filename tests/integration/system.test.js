const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TEST_ENV = 'true';

const { app: productApp } = require('../../services/product-service/product-service');

async function start(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stop(server) {
  await new Promise(resolve => server.close(resolve));
}

test('system health, product, order, metrics, and request ID integration', async t => {
  const product = await start(productApp);
  process.env.PRODUCT_SERVICE_URL = product.baseUrl;
  delete require.cache[require.resolve('../../services/order-service/order-service')];
  const { app: orderApp } = require('../../services/order-service/order-service');
  const order = await start(orderApp);

  delete require.cache[require.resolve('../../gateway.js')];
  process.env.PRODUCT_SERVICE_URL = product.baseUrl;
  process.env.ORDER_SERVICE_URL = order.baseUrl;
  const { app: gatewayApp } = require('../../gateway.js');
  const gateway = await start(gatewayApp);

  t.after(async () => {
    await stop(gateway.server);
    await stop(order.server);
    await stop(product.server);
  });

  const productListResponse = await fetch(`${gateway.baseUrl}/product-service/products`);
  assert.equal(productListResponse.status, 200);
  assert.ok(Array.isArray(await productListResponse.json()));

  const productDetailResponse = await fetch(`${gateway.baseUrl}/product-service/products/1`);
  assert.equal(productDetailResponse.status, 200);
  assert.equal((await productDetailResponse.json()).id, 1);

  const requestId = 'integration-request-2026';
  const orderResponse = await fetch(`${gateway.baseUrl}/order-service/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
    },
    body: JSON.stringify({ productId: 1, qty: 1 }),
  });
  assert.equal(orderResponse.status, 201);
  assert.equal(orderResponse.headers.get('X-Request-Id'), requestId);

  const invalidOrderResponse = await fetch(`${gateway.baseUrl}/order-service/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: 1, qty: 0 }),
  });
  assert.equal(invalidOrderResponse.status, 400);

  const unknownProductResponse = await fetch(`${gateway.baseUrl}/order-service/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: 99, qty: 1 }),
  });
  assert.equal(unknownProductResponse.status, 404);

  const insufficientStockResponse = await fetch(`${gateway.baseUrl}/order-service/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: 3, qty: 999 }),
  });
  assert.equal(insufficientStockResponse.status, 409);

  for (const url of [
    `${gateway.baseUrl}/health`,
    `${product.baseUrl}/health`,
    `${order.baseUrl}/health`,
  ]) {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ok');
  }

  for (const url of [
    `${gateway.baseUrl}/metrics`,
    `${product.baseUrl}/metrics`,
    `${order.baseUrl}/metrics`,
  ]) {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/plain|text\/openmetrics/);
    assert.match(await response.text(), /http_requests_total/);
  }

  const directProductHealth = await fetch(`${product.baseUrl}/health`);
  assert.ok(directProductHealth.headers.get('X-Request-Id'));

  const directOrderHealth = await fetch(`${order.baseUrl}/health`);
  assert.ok(directOrderHealth.headers.get('X-Request-Id'));
});
