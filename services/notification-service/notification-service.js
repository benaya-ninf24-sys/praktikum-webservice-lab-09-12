const amqp = require('amqplib');
const express = require('express');
const client = require('prom-client');

const app = express();
function logJson(level, message, fields = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'notification-service',
    message,
    ...fields,
  }));
}

const register = new client.Registry();
register.setDefaultLabels({ service: 'notification-service' });
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
    httpRequests.inc({ service: 'notification-service', method, route, status_code: statusCode });
    httpRequestsByMethod.inc({ service: 'notification-service', method });
    httpRequestsByStatus.inc({ service: 'notification-service', status_code: statusCode });
    httpDuration.observe(
      { service: 'notification-service', method, route, status_code: statusCode },
      durationSeconds,
    );
    if (response.statusCode >= 400) {
      httpErrors.inc({ service: 'notification-service', method, route, status_code: statusCode });
    }
    logJson(
      response.statusCode >= 400 ? 'warn' : 'info',
      'HTTP request completed',
      {
        method,
        path: request.originalUrl.split('?')[0],
        statusCode: response.statusCode,
        responseTime: Math.round(durationSeconds * 1000),
      },
    );
  });
  next();
});

app.get('/metrics', async (request, response) => {
  response.set('Content-Type', register.contentType);
  response.send(await register.metrics());
});

app.get('/health', (request, response) => {
  response.json({
    status: 'ok',
    service: 'notification-service',
    uptimeSec: Math.floor(process.uptime()),
  });
});

const METRICS_PORT = Number(process.env.METRICS_PORT || 3002);
if (require.main === module) {
  app.listen(METRICS_PORT, () => {
    logJson('info', `Notification metrics server listening on port ${METRICS_PORT}`, { port: METRICS_PORT });
  });
}

const AMQP_URL = process.env.AMQP_URL || 'amqp://localhost';
const QUEUE = process.argv.slice(2).find(a => !a.startsWith('--')) || 'notification-queue';
const CRASH = process.argv.includes('--crash');
const processed = new Set();

async function processMessage(channel, msg, delayMs = 1000, crashOnTest = CRASH) {
  if (!msg) return;
  let event;
  try {
    event = JSON.parse(msg.content.toString());
  } catch {
    const messageId = msg.properties?.messageId;
    logJson('error', 'pesan rusak, dibuang', { messageId });
    logJson('warn', 'NACK malformed message', { messageId, action: 'nack' });
    return channel.nack(msg, false, false);
  }

  const id = msg.properties.messageId;
  const requestId = event.requestId || event.correlationId || event.data?.requestId;
  logJson('info', 'Event diterima', {
    messageId: id,
    requestId,
    correlationId: event.correlationId || requestId,
  });

  if (processed.has(id)) {
    logJson('info', 'Pesan duplikat dilewati', {
      messageId: id,
      requestId,
      correlationId: event.correlationId || requestId,
      action: 'ack',
    });
    return channel.ack(msg);
  }

  await new Promise(resolve => setTimeout(resolve, delayMs));
  logJson('info', 'Email notification terkirim', {
    messageId: id,
    requestId,
    correlationId: event.correlationId || requestId,
    queue: QUEUE,
    orderId: event.data?.id,
  });
  processed.add(id);

  if (crashOnTest) {
    logJson('error', 'crash sebelum ACK', {
      messageId: id,
      requestId,
      correlationId: event.correlationId || requestId,
      action: 'no_ack',
    });
    throw new Error('simulated consumer crash');
  }
  logJson('info', 'ACK message', {
    messageId: id,
    requestId,
    correlationId: event.correlationId || requestId,
    action: 'ack',
  });
  channel.ack(msg);
}

async function main() {
  const conn = await amqp.connect(AMQP_URL);
  const ch = await conn.createChannel();
  await ch.assertExchange('orders', 'fanout', { durable: true });
  await ch.assertQueue(QUEUE, { durable: true });
  await ch.bindQueue(QUEUE, 'orders', '');
  ch.prefetch(1);
  logJson('info', 'Notification consumer menunggu pesan', { queue: QUEUE });

  ch.consume(QUEUE, msg => processMessage(ch, msg));
}
if (require.main === module) {
  main().catch(e => {
    logJson('error', 'RabbitMQ connection error, retry in 3 seconds', { error: e.message });
    setTimeout(main, 3000);
  });
}

module.exports = { app, main, processMessage, processed };
