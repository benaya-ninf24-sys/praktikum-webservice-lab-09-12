const express = require('express');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { randomUUID } = require('crypto');
const client = require('prom-client');

const app = express();
function logJson(level, message, fields = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'product-service',
    message,
    ...fields,
  }));
}

app.use(express.json());
const register = new client.Registry();
register.setDefaultLabels({ service: 'product-service' });
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

    httpRequests.inc({ service: 'product-service', method, route, status_code: statusCode });
    httpRequestsByMethod.inc({ service: 'product-service', method });
    httpRequestsByStatus.inc({ service: 'product-service', status_code: statusCode });
    httpDuration.observe(
      { service: 'product-service', method, route, status_code: statusCode },
      durationSeconds,
    );
    if (response.statusCode >= 400) {
      httpErrors.inc({ service: 'product-service', method, route, status_code: statusCode });
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
    info: { title: 'Product Service', version: '1.0.0', description: 'Data produk dan stok' },
    servers: [{ url: 'http://localhost:3000' }],
  },
  apis: [__filename],
});
app.get('/openapi.json', (req, res) => res.json(spec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'product-service',
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
 *     Product:
 *       type: object
 *       properties:
 *         id: { type: integer, example: 1 }
 *         name: { type: string, example: Keyboard Mekanik }
 *         price: { type: integer, example: 450000 }
 *         stock: { type: integer, example: 10 }
 *         category: { type: string, example: Periferal }
 *     ReserveRequest:
 *       type: object
 *       required: [qty]
 *       properties:
 *         qty: { type: integer, minimum: 1, example: 2 }
 *     Error:
 *       type: object
 *       properties:
 *         error: { type: string, example: Produk tidak ditemukan }
 * /products:
 *   get:
 *     tags: [Products]
 *     summary: Daftar semua produk
 *     responses:
 *       200:
 *         description: Berhasil
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Product' }
 * /products/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Detail satu produk
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Berhasil
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Product' }
 *       404: { description: Produk tidak ditemukan, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 * /products/{id}/reserve:
 *   post:
 *     tags: [Products]
 *     summary: Kurangi stok produk (dipanggil service lain)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ReserveRequest' }
 *     responses:
 *       200:
 *         description: Stok berhasil dikurangi
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Product' }
 *       400: { description: qty tidak valid, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Produk tidak ditemukan, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Stok tidak cukup, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */

const products = [
  { id: 1, name: 'Keyboard Mekanik', price: 450000, stock: 10, category: 'Periferal' },
  { id: 2, name: 'Mouse Wireless', price: 175000, stock: 25, category: 'Periferal' },
  { id: 3, name: 'Monitor 24 inci', price: 1850000, stock: 5, category: 'Periferal' },
];

function findProduct(productId) {
  return products.find((item) => item.id === Number(productId));
}

function validateReserveQty(qty) {
  return Number.isInteger(qty) && qty > 0;
}

function reserveStock(productId, qty) {
  const product = findProduct(productId);
  if (!product) {
    return { status: 404, body: { error: 'Product not found' } };
  }
  if (!validateReserveQty(qty)) {
    return {
      status: 400,
      body: { error: 'qty must be an integer greater than 0' },
    };
  }
  if (product.stock < qty) {
    return { status: 409, body: { error: 'Insufficient stock' } };
  }
  product.stock -= qty;
  return { status: 200, body: product };
}

app.get('/products', (request, response) => {
  response.json(products);
});

app.get('/products/:id', (request, response) => {
  const product = products.find((item) => item.id === Number(request.params.id));

  if (!product) {
    return response.status(404).json({ error: 'Product not found' });
  }

  response.json(product);
});

app.post('/products/:id/reserve', (request, response) => {
  logJson('info', 'Received stock reservation request', {
    requestId: request.requestId,
    method: request.method,
    path: request.originalUrl,
  });
  const result = reserveStock(request.params.id, request.body.qty);
  return response.status(result.status).json(result.body);
});

const port = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(port, () => {
    logJson('info', `Product service listening on port ${port}`, { port });
  });
}

module.exports = {
  app,
  products,
  findProduct,
  validateReserveQty,
  reserveStock,
};
