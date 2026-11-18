const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findProduct,
  validateReserveQty,
  reserveStock,
  products,
} = require('../../services/product-service/product-service');

test('findProduct returns a product for a valid ID', () => {
  assert.equal(findProduct(1).name, 'Keyboard Mekanik');
});

test('findProduct returns undefined for unknown ID', () => {
  assert.equal(findProduct(99), undefined);
});

test('validateReserveQty accepts only positive integers', () => {
  assert.equal(validateReserveQty(1), true);
  assert.equal(validateReserveQty(0), false);
  assert.equal(validateReserveQty(-1), false);
  assert.equal(validateReserveQty(1.5), false);
  assert.equal(validateReserveQty('1'), false);
});

test('reserveStock returns not found for unknown product', () => {
  assert.deepEqual(reserveStock(99, 1), {
    status: 404,
    body: { error: 'Product not found' },
  });
});

test('reserveStock returns bad request for invalid quantity', () => {
  assert.equal(reserveStock(1, 0).status, 400);
});

test('reserveStock returns conflict when stock is insufficient', () => {
  assert.equal(reserveStock(3, 999).status, 409);
});

test('reserveStock decrements stock and returns updated product', () => {
  const product = products.find(item => item.id === 2);
  const before = product.stock;
  const result = reserveStock(2, 1);
  assert.equal(result.status, 200);
  assert.equal(result.body.stock, before - 1);
});
