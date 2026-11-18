const express = require('express');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const amqp = require('amqplib');
const { randomUUID } = require('crypto');
const client = require('prom-client');

const PRODUCT_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3000';
const AMQP_URL = process.env.AMQP_URL || 'amqp://localhost';
let channel = null;
function logJson(level, message, fields = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'order-service',
    message,
    ...fields,
  }));
}

async function connectQueue() {
  try {
    const conn = await amqp.connect(AMQP_URL);
    conn.on('error', () => {});
    conn.on('close', () => { channel = null; setTimeout(connectQueue, 3000); });
    channel = await conn.createChannel();
    await channel.assertExchange('orders', 'fanout', { durable: true });
    logJson('info', 'terhubung ke RabbitMQ');
  } catch (e) {
    logJson('error', 'RabbitMQ belum tersedia, coba lagi dalam 3 detik', { error: e.message });
    setTimeout(connectQueue, 3000);
  }
}

function publishOrderCreated(order, requestId) {
  if (!channel) {
    logJson('warn', 'channel tidak tersedia, event TIDAK terkirim', {
      requestId,
      orderId: order.id,
    });
    return false;
  }
  const body = Buffer.from(JSON.stringify({
    type: 'order.created',
    requestId,
    correlationId: requestId,
    data: order,
  }));
  return channel.publish('orders', '', body,
    { persistent: true, contentType: 'application/json', messageId: `order-${order.id}` });
}
const app = express();
app.use(express.json());
const register = new client.Registry();
register.setDefaultLabels({ service: 'order-service' });
client.collectDefaultMetrics({ register });

const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['service', 'method', 'route', 'status_code'],
  registers: [register],
});
const httpRequestsByMethod = new client.Counter({
  name: 'http_requests_by_method_total',
  help: 'Total HTTP requests grouped by method',
  labelNames: ['service', 'method'],
  registers: [register],
});
const httpRequestsByStatus = new client.Counter({
  name: 'http_requests_by_status_total',
  help: 'Total HTTP requests grouped by status code',
  labelNames: ['service', 'status_code'],
  registers: [register],
});
const httpErrors = new client.Counter({
  name: 'http_errors_total',
  help: 'Total HTTP error responses',
  labelNames: ['service', 'method', 'route', 'status_code'],
  registers: [register],
});
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['service', 'method', 'route', 'status_code'],
  registers: [register],
});

app.use((request, response, next) => {
  if (request.path === '/metrics') return next();

  const startedAt = process.hrtime.bigint();
  response.on('finish', () => {
    const route = request.route?.path || 'unknown';
    const method = request.method;
    const statusCode = String(response.statusCode);
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

    httpRequests.inc({ service: 'order-service', method, route, status_code: statusCode });
    httpRequestsByMethod.inc({ service: 'order-service', method });
    httpRequestsByStatus.inc({ service: 'order-service', status_code: statusCode });
    httpDuration.observe(
      { service: 'order-service', method, route, status_code: statusCode },
      durationSeconds,
    );
    if (response.statusCode >= 400) {
      httpErrors.inc({ service: 'order-service', method, route, status_code: statusCode });
    }
    logJson(
      response.statusCode >= 400 ? 'warn' : 'info',
      'HTTP request completed',
      {
        requestId: request.requestId,
        method,
        path: request.originalUrl.split('?')[0],
        statusCode: response.statusCode,
        responseTime: Math.round(durationSeconds * 1000),
      },
    );
  });
  next();
});

function resolveRequestId(request) {
  const headerValue = request.get('X-Request-Id');
  if (
    typeof headerValue === 'string'
    && headerValue.length <= 128
    && /^[\x21-\x7E]+$/.test(headerValue)
  ) {
    return headerValue;
  }
  return randomUUID();
}

app.use((request, response, next) => {
  const requestId = resolveRequestId(request);
  request.requestId = requestId;
  response.set('X-Request-Id', requestId);
  next();
});

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: { title: 'Order Service', version: '1.0.0', description: 'Pembuatan dan daftar pesanan' },
    servers: [{ url: 'http://localhost:3001' }],
  },
  apis: [__filename],
});
app.get('/openapi.json', (req, res) => res.json(spec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'order-service',
    uptimeSec: Math.floor(process.uptime()),
  });
});

app.get('/metrics', async (request, response) => {
  response.set('Content-Type', register.contentType);
  response.send(await register.metrics());
});

/**
 * @openapi
 * components:
 *   schemas:
 *     OrderRequest:
 *       type: object
 *       required: [productId, qty]
 *       properties:
 *         productId: { type: integer, example: 1 }
 *         qty: { type: integer, minimum: 1, example: 2 }
 *     Order:
 *       type: object
 *       properties:
 *         id: { type: integer, example: 1 }
 *         productId: { type: integer, example: 1 }
 *         productName: { type: string, example: Keyboard Mekanik }
 *         qty: { type: integer, example: 2 }
 *         total: { type: integer, example: 900000 }
 *         createdAt: { type: string, format: date-time }
 *     Error:
 *       type: object
 *       properties:
 *         error: { type: string, example: Stok tidak cukup }
 * /orders:
 *   post:
 *     tags: [Orders]
 *     summary: Buat pesanan baru
 *     description: Memanggil product-service untuk mengurangi stok, lalu menyimpan pesanan.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/OrderRequest' }
 *     responses:
 *       201:
 *         description: Pesanan dibuat
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Order' }
 *       400: { description: Input tidak valid, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Produk tidak ditemukan, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Stok tidak cukup, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       503: { description: product-service tidak tersedia, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *   get:
 *     tags: [Orders]
 *     summary: Daftar semua pesanan
 *     responses:
 *       200:
 *         description: Berhasil
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Order' }
 */



const orders = [];

function validateOrderInput(productId, qty) {
  return Number.isInteger(productId) && Number.isInteger(qty) && qty >= 1;
}

function setChannel(testChannel) {
  channel = testChannel;
}

app.post('/orders', async (request, response) => {
  const { productId, qty } = request.body;

  if (!validateOrderInput(productId, qty)) {
    return response.status(400).json({
      error: 'productId and qty must be integers, and qty must be at least 1',
    });
  }

  let productResponse;
  try {
    logJson('info', 'Forwarding request to Product Service', {
      requestId: request.requestId,
      method: 'POST',
      path: `/products/${productId}/reserve`,
      productId,
      qty,
    });
    productResponse = await fetch(
      `${PRODUCT_URL}/products/${productId}/reserve`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': request.requestId,
        },
        body: JSON.stringify({ qty }),
        signal: AbortSignal.timeout(2000),
      },
    );
  } catch (error) {
    logJson('error', 'Product Service request failed', {
      requestId: request.requestId,
      method: 'POST',
      path: `/products/${productId}/reserve`,
      error: error.message,
    });
    return response
      .status(503)
      .json({ error: 'product-service tidak tersedia, coba lagi nanti' });
  }

  const data = await productResponse.json();

  if (!productResponse.ok) {
    return response.status(productResponse.status).json(data);
  }

  const order = {
    id: orders.length + 1,
    productId,
    productName: data.name,
    qty,
    total: data.price * qty,
    createdAt: new Date().toISOString(),
  };
  orders.push(order);
  publishOrderCreated(order, request.requestId);

  response.status(201).json(order);
});

app.get('/orders', (request, response) => {
  response.json(orders);
});

const port = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(port, () => {
    logJson('info', `Order service listening on port ${port}`, { port });
    connectQueue();
  });
}

module.exports = {
  app,
  orders,
  validateOrderInput,
  publishOrderCreated,
  setChannel,
};
