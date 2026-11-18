const SERVICES = [
  { name: 'API Gateway', url: process.env.GATEWAY_URL || 'http://localhost:8080/health' },
  { name: 'Product Service', url: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3000/health' },
  { name: 'Order Service', url: process.env.ORDER_SERVICE_URL || 'http://localhost:3001/health' },
  { name: 'Notification', url: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002/health' },
];

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

const intervalMs = positiveInteger(process.env.MONITOR_INTERVAL_MS, 5000);
const timeoutMs = positiveInteger(process.env.MONITOR_TIMEOUT_MS, 2000);
let checkInProgress = false;
let stopped = false;
let intervalHandle;

function formatTime(date = new Date()) {
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

function formatDuration(milliseconds) {
  return `${Math.round(milliseconds)}ms`;
}

async function checkService(service) {
  const startedAt = process.hrtime.bigint();

  try {
    const response = await fetch(service.url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    const healthy = response.ok
      && (!body || body.status === undefined || body.status === 'ok');

    if (healthy) {
      return {
        ...service,
        state: 'HEALTHY',
        statusCode: response.status,
        elapsedMs,
      };
    }

    return {
      ...service,
      state: 'UNHEALTHY',
      statusCode: response.status,
      elapsedMs,
      warning: `HTTP status ${response.status} returned an unhealthy response`,
    };
  } catch (error) {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const timedOut = error?.name === 'TimeoutError'
      || error?.name === 'AbortError';

    return {
      ...service,
      state: 'UNHEALTHY',
      statusCode: '-',
      elapsedMs,
      warning: timedOut
        ? `TIMEOUT after ${timeoutMs}ms`
        : `CONNECTION ERROR: ${error.message}`,
    };
  }
}

async function runCheck() {
  if (checkInProgress || stopped) return;
  checkInProgress = true;

  try {
    const results = await Promise.all(SERVICES.map(checkService));
    for (const result of results) {
      const time = formatTime();
      const name = result.name.padEnd(18, ' ');
      const statusCode = String(result.statusCode).padStart(3, ' ');

      if (result.state === 'HEALTHY') {
        console.log(
          `[${time}] ${name} HEALTHY  HTTP ${statusCode}  ${formatDuration(result.elapsedMs)}  ${result.url}`,
        );
      } else {
        console.warn(
          `[${time}] ${name} UNHEALTHY  HTTP ${statusCode}  ${formatDuration(result.elapsedMs)}  ${result.url}`,
        );
        console.warn(`  WARNING: ${result.warning}`);
      }
    }
  } finally {
    checkInProgress = false;
  }
}

async function shutdown(signal) {
  if (stopped) return;
  stopped = true;
  if (intervalHandle) clearInterval(intervalHandle);
  console.log(`\nMonitoring stopped gracefully (${signal}).`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log(`Starting service monitoring every ${intervalMs}ms (timeout: ${timeoutMs}ms)...`);
runCheck();
intervalHandle = setInterval(runCheck, intervalMs);
