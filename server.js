import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const app = express();
const port = Number(process.env.PORT) || 3000;
const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.join(rootDirectory, 'dist');

app.disable('x-powered-by');
app.get('/healthz', (_request, response) => response.status(200).type('text').send('ok'));
app.use(express.static(distDirectory, {
  index: false,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  etag: true,
}));

// Client-side routes all use Vite's built entry document.
app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(distDirectory, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Backrooms server listening on port ${port}`);
});
