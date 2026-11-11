const express = require('express');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const PRODUCT_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3000';
const app = express();
app.use(express.json());

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

app.post('/orders', async (request, response) => {
  const { productId, qty } = request.body;

  if (!Number.isInteger(productId) || !Number.isInteger(qty) || qty < 1) {
    return response.status(400).json({
      error: 'productId and qty must be integers, and qty must be at least 1',
    });
  }

  let productResponse;
  try {
    productResponse = await fetch(
      `${PRODUCT_URL}/products/${productId}/reserve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty }),
        signal: AbortSignal.timeout(2000),
      },
    );
  } catch (error) {
    console.error(`product-service request failed: ${error.message}`);
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

  response.status(201).json(order);
});

app.get('/orders', (request, response) => {
  response.json(orders);
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Order service listening on port ${port}`);
});
