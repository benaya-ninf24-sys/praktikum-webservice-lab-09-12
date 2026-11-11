const express = require('express');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

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
      console.warn('dokumentasi gagal diambil dari', s.url);
    }
  }
  return merged;
}

app.get('/openapi.json', async (req, res) => res.json(await buildSpec()));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(null, { swaggerOptions: { url: '/openapi.json' } }));


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
        console.log(
          `Proxying ${request.method} ${request.originalUrl} to ${serviceName}`,
        );
      },
      error: (error, request, response) => {
        console.error(`${serviceName} proxy error: ${error.message}`);
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
app.listen(port, () => {
  console.log(`Gateway listening on port ${port}`);
});
