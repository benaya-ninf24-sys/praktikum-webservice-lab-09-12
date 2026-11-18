const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateOrderInput,
  publishOrderCreated,
  setChannel,
} = require('../../services/order-service/order-service');

test('validateOrderInput accepts positive integer input', () => {
  assert.equal(validateOrderInput(1, 2), true);
});

test('validateOrderInput rejects missing, zero, negative, and decimal values', () => {
  assert.equal(validateOrderInput(undefined, 1), false);
  assert.equal(validateOrderInput(1, 0), false);
  assert.equal(validateOrderInput(1, -1), false);
  assert.equal(validateOrderInput(1, 1.5), false);
  assert.equal(validateOrderInput('1', 1), false);
});

test('publishOrderCreated does not publish without RabbitMQ channel', () => {
  setChannel(null);
  assert.equal(publishOrderCreated({ id: 1 }), false);
});

test('publishOrderCreated publishes order.created message with message ID', () => {
  const published = [];
  setChannel({
    publish(exchange, routingKey, body, options) {
      published.push({ exchange, routingKey, body: JSON.parse(body.toString()), options });
      return true;
    },
  });

  assert.equal(publishOrderCreated({ id: 7, productName: 'Keyboard', qty: 1 }), true);
  assert.equal(published[0].exchange, 'orders');
  assert.equal(published[0].body.type, 'order.created');
  assert.equal(published[0].body.data.id, 7);
  assert.equal(published[0].options.messageId, 'order-7');
});
