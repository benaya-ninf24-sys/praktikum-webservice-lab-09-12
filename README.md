# Praktikum Web Service - Lab 10: Dokumentasi Service & Gateway (OpenAPI / Swagger)

## 1. Deskripsi Sistem
Sistem ini mengimplementasikan pendekatan **code-first documentation** menggunakan OpenAPI 3.0.3, `swagger-jsdoc`, dan `swagger-ui-express`.
Setiap microservice mendeskripsikan dirinya sendiri melalui JSDoc annotations di file kodenya.
API Gateway bertindak sebagai agregator yang mengambil spesifikasi OpenAPI dari masing-masing upstream service secara dinamis (`/openapi.json`), menambahkan prefix rute service, menggabungkan skema komponen, dan menyajikan Swagger UI terpadu di `/docs`.

```
Browser ──▶ Gateway :8080/docs (Swagger UI gabungan)
                │ GET /openapi.json (agregasi saat diminta)
                ├──▶ product-service :3000/openapi.json (+ :3000/docs)
                └──▶ order-service   :3001/openapi.json (+ :3001/docs)
```

## 2. Port & Alamat Layanan
| Service | Port | Endpoint OpenAPI | Swagger UI |
|---|---|---|---|
| Product Service | `3000` | `http://localhost:3000/openapi.json` | `http://localhost:3000/docs` |
| Order Service | `3001` | `http://localhost:3001/openapi.json` | `http://localhost:3001/docs` |
| API Gateway | `8080` | `http://localhost:8080/openapi.json` | `http://localhost:8080/docs` |

## 3. Environment Variables
### Gateway (`gateway.js`)
- `PORT`: Port gateway (default: `8080`)
- `PRODUCT_SERVICE_URL`: URL reverse proxy untuk product-service (default: `http://localhost:3000`)
- `ORDER_SERVICE_URL`: URL reverse proxy untuk order-service (default: `http://localhost:3001`)
- `PRODUCT_DOC_URL`: Endpoint OpenAPI product-service (default: `http://localhost:3000/openapi.json`)
- `ORDER_DOC_URL`: Endpoint OpenAPI order-service (default: `http://localhost:3001/openapi.json`)

### Product Service (`services/product-service/product-service.js`)
- `PORT`: Port service (default: `3000`)

### Order Service (`services/order-service/order-service.js`)
- `PORT`: Port service (default: `3001`)
- `PRODUCT_SERVICE_URL`: Base URL product-service untuk reserve stok (default: `http://localhost:3000`)

### Notification Service (`services/notification-service/notification-service.js`)
- `METRICS_PORT`: Port metrics dan health Notification Service (default: `3002`)
- `AMQP_URL`: URL RabbitMQ (default: `amqp://localhost`)

## 4. Cara Menjalankan Layanan
Jalankan dependensi dan service sesuai urutan berikut:

### Langkah A: Install Dependensi
```bash
# 1. Product Service
cd services/product-service
npm install

# 2. Order Service
cd ../order-service
npm install

# 3. Gateway
cd ../..
npm install
```

### Langkah B: Jalankan Setiap Service di Terminal Terpisah
```bash
# Terminal 1 - Jalankan Product Service (:3000)
cd services/product-service
node product-service.js

# Terminal 2 - Jalankan Order Service (:3001)
cd services/order-service
node order-service.js

# Terminal 3 - Jalankan Gateway (:8080)
node gateway.js
```

Akses dokumentasi gabungan di browser:
`http://localhost:8080/docs`

## 5. Ringkasan Pengujian Endpoint
Semua endpoint diuji melalui Gateway (`http://localhost:8080`):

1. **POST `/order-service/orders` (HTTP 201 Created)**
   - Request Body: `{"productId": 1, "qty": 2}`
   - Result: Pesanan terbentuk, stok berkurang dari 10 menjadi 8.
2. **GET `/product-service/products/1` (HTTP 200 OK)**
   - Result: Menampilkan data produk dengan stok yang telah dikurangi dan memuat field `category: "Periferal"`.
3. **POST `/order-service/orders` (HTTP 409 Conflict)**
   - Request Body: `{"productId": 1, "qty": 999}`
   - Result: `{"error": "Insufficient stock"}` sesuai spesifikasi.
4. **POST `/order-service/orders` (HTTP 404 Not Found)**
   - Request Body: `{"productId": 99, "qty": 1}`
   - Result: `{"error": "Product not found"}` sesuai spesifikasi.
5. **POST `/order-service/orders` saat Product Service mati (HTTP 503 Service Unavailable)**
   - Result: `{"error": "product-service tidak tersedia, coba lagi nanti"}` sesuai spesifikasi.

## 6. Penanganan Drift Dokumentasi (Langkah 05)
- **Kondisi Awal (Drift)**: Data runtime `products` ditambahkan atribut `category: 'Periferal'`, namun skema OpenAPI belum memuat definisi `category`. Akibatnya, respons riil tidak cocok dengan janji dokumentasi.
- **Perbaikan**: Skema `Product` di `@openapi` JSDoc diperbarui dengan menambahkan:
  ```yaml
  category: { type: string, example: Periferal }
  ```
- **Catatan**: Code-first mengurangi drift karena anotasi berada satu file dengan kode, namun drift tetap dapat terjadi jika programmer mengubah kode logika/data tanpa memperbarui komentar `@openapi`.

## 7. Monitoring Service

Jalankan semua service terlebih dahulu, kemudian mulai monitoring dari root project:

```bash
npm run monitor
```

Pemeriksaan akan berjalan secara berkala dengan interval default 5 detik dan timeout default 2 detik. Tekan `Ctrl+C` untuk menghentikan monitoring dengan aman.

Konfigurasi dapat diubah melalui environment variable:

```bash
# PowerShell
$env:GATEWAY_URL="http://localhost:8080/health"
$env:PRODUCT_SERVICE_URL="http://localhost:3000/health"
$env:ORDER_SERVICE_URL="http://localhost:3001/health"
$env:NOTIFICATION_SERVICE_URL="http://localhost:3002/health"
$env:MONITOR_INTERVAL_MS="5000"
$env:MONITOR_TIMEOUT_MS="2000"
npm run monitor
```

Variabel konfigurasi juga dapat dipakai langsung tanpa `npm run`:

```bash
node scripts/monitor.js
```
