const express = require('express');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { randomUUID } = require('crypto');
const client = require('prom-client');

const app = express();
function logJson(level, message, fields = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'gateway',
    message,
    ...fields,
  }));
}

const register = new client.Registry();
register.setDefaultLabels({ service: 'gateway' });
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
    const route = request.route?.path
      || (request.originalUrl.split('?')[0].startsWith('/metrics') ? 'metrics' : 'unknown');
    const method = request.method;
    const statusCode = String(response.statusCode);
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

    httpRequests.inc({ service: 'gateway', method, route, status_code: statusCode });
    httpRequestsByMethod.inc({ service: 'gateway', method });
    httpRequestsByStatus.inc({ service: 'gateway', status_code: statusCode });
    httpDuration.observe(
      { service: 'gateway', method, route, status_code: statusCode },
      durationSeconds,
    );
    if (response.statusCode >= 400) {
      httpErrors.inc({ service: 'gateway', method, route, status_code: statusCode });
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
  logJson('info', 'HTTP request received', {
    requestId,
    method: request.method,
    path: request.originalUrl.split('?')[0],
  });
  next();
});

const DOC_SOURCES = [
  { prefix: '/product-service', url: process.env.PRODUCT_DOC_URL || 'http://localhost:3000/openapi.json' },
  { prefix: '/order-service', url: process.env.ORDER_DOC_URL || 'http://localhost:3001/openapi.json' },
];

async function buildSpec() {
  const merged = {
    openapi: '3.0.3',
    info: { title: 'Toko API (via Gateway)', version: '1.0.0' },
    servers: [{ url: '/' }],
    paths: {},
    components: { schemas: {} },
  };
  for (const s of DOC_SOURCES) {
    try {
      const spec = await fetch(s.url, { signal: AbortSignal.timeout(2000) }).then((r) => r.json());
      for (const [path, ops] of Object.entries(spec.paths || {})) merged.paths[s.prefix + path] = ops;
      Object.assign(merged.components.schemas, (spec.components || {}).schemas);
    } catch (e) {
      logJson('warn', 'dokumentasi gagal diambil', { url: s.url, error: e.message });
    }
  }
  return merged;
}

app.get('/openapi.json', async (req, res) => res.json(await buildSpec()));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(null, { swaggerOptions: { url: '/openapi.json' } }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'gateway',
    uptimeSec: Math.floor(process.uptime()),
  });
});

app.get('/metrics', async (request, response) => {
  response.set('Content-Type', register.contentType);
  response.send(await register.metrics());
});

app.use(
  rateLimit({
    windowMs: 10 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
  }),
);

function createServiceProxy(prefix, target, serviceName) {
  return createProxyMiddleware({
    pathFilter: (pathname) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`),
    target,
    changeOrigin: true,
    pathRewrite: { [`^${prefix}(?=/|$)`]: '' },
    on: {
      proxyReq: (proxyRequest, request) => {
      proxyRequest.setHeader('X-Request-Id', request.requestId);
        logJson('info', 'Forwarding request to service', {
          requestId: request.requestId,
          method: request.method,
          path: request.originalUrl.split('?')[0],
          targetService: serviceName,
        });
      },
      error: (error, request, response) => {
        logJson('error', 'Service proxy error', {
          requestId: request?.requestId,
          targetService: serviceName,
          error: error.message,
        });
        if (!response.headersSent) {
          response.writeHead(502, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'Upstream service unavailable' }));
        }
      },
    },
  });
}

app.use(
  createServiceProxy(
    '/product-service',
    process.env.PRODUCT_SERVICE_URL || 'http://localhost:3000',
    'product-service',
  ),
);
app.use(
  createServiceProxy(
    '/order-service',
    process.env.ORDER_SERVICE_URL || 'http://localhost:3001',
    'order-service',
  ),
);

const port = Number(process.env.PORT || 8080);
if (require.main === module) {
  app.listen(port, () => {
    logJson('info', `Gateway listening on port ${port}`, { port });
  });
}

module.exports = { app, buildSpec };
