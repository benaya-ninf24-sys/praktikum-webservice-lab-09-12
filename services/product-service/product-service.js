const express = require('express');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const app = express();
app.use(express.json());

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
  const product = products.find((item) => item.id === Number(request.params.id));

  if (!product) {
    return response.status(404).json({ error: 'Product not found' });
  }

  const { qty } = request.body;

  if (!Number.isInteger(qty) || qty <= 0) {
    return response.status(400).json({
      error: 'qty must be an integer greater than 0',
    });
  }

  if (product.stock < qty) {
    return response.status(409).json({ error: 'Insufficient stock' });
  }

  product.stock -= qty;
  response.json(product);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Product service listening on port ${port}`);
});
