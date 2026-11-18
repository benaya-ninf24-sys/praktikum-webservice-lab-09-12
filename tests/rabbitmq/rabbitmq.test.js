const test = require('node:test');
const assert = require('node:assert/strict');

const notification = require('../../services/notification-service/notification-service');
const order = require('../../services/order-service/order-service');

test('order.created is published to RabbitMQ exchange', () => {
  let published;
  order.setChannel({
    publish(exchange, routingKey, body, options) {
      published = { exchange, routingKey, body: JSON.parse(body.toString()), options };
      return true;
    },
  });

  assert.equal(order.publishOrderCreated({ id: 42, productName: 'Test', qty: 2 }), true);
  assert.equal(published.exchange, 'orders');
  assert.equal(published.body.type, 'order.created');
  assert.equal(published.body.data.id, 42);
  assert.equal(published.options.messageId, 'order-42');
  order.setChannel(null);
});

test('notification consumer receives and acknowledges an order event', async () => {
  let acked = false;
  const msg = {
    content: Buffer.from(JSON.stringify({
      type: 'order.created',
      data: { id: 10, productName: 'Keyboard', qty: 1 },
    })),
    properties: { messageId: 'order-10-test' },
  };
  const channel = { ack: () => { acked = true; }, nack: () => {} };

  await notification.processMessage(channel, msg, 0);
  assert.equal(acked, true);
});

test('notification consumer acknowledges duplicate message', async () => {
  let ackCount = 0;
  const msg = {
    content: Buffer.from(JSON.stringify({
      type: 'order.created',
      data: { id: 11, productName: 'Mouse', qty: 1 },
    })),
    properties: { messageId: 'order-duplicate-test' },
  };
  const channel = { ack: () => { ackCount += 1; }, nack: () => {} };

  await notification.processMessage(channel, msg, 0);
  await notification.processMessage(channel, msg, 0);
  assert.equal(ackCount, 2);
  assert.equal(notification.processed.has('order-duplicate-test'), true);
});

test('consumer unavailable is represented by no publish channel', () => {
  order.setChannel(null);
  assert.equal(order.publishOrderCreated({ id: 99 }), false);
});
