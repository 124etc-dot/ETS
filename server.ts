import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { processOcrDocument } from './api/ocr/process';

dotenv.config();

const app = express();
const PORT = 3000;

// Enable CORS for local app wrappers, PWAs, or alternate dev ports
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Set high limits for base64 file payloads (PDFs and high-res phone camera photos)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health endpoint
app.get(['/api/health', '/api/health/'], (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString(),
  });
});

// OCR Status Check / GET info
app.get(['/api/ocr', '/api/ocr/process', '/api/ocr/process/'], (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    endpoint: '/api/ocr/process',
    method: 'POST',
  });
});

// Primary OCR Endpoint (supports all common route aliases)
app.post(['/api/ocr/process', '/api/ocr/process/', '/api/ocr', '/api/ocr/', '/api/process'], async (req, res) => {
  try {
    const {
      fileData,
      mimeType,
      fileName,
      ourCompanies,
      suppliers,
      knownOrders,
      docTypeHint,
    } = req.body || {};

    const result = await processOcrDocument({
      fileData,
      mimeType,
      fileName,
      ourCompanies,
      suppliers,
      knownOrders,
      docTypeHint,
    });

    if (!result.success) {
      return res.status(result.statusCode || 500).json(result);
    }

    return res.json(result);
  } catch (error: any) {
    console.error('OCR Processing error in server.ts:', error);
    let userFriendlyMessage = 'Помилка обробки документа через Gemini OCR.';
    const rawMsg = error?.message || String(error);
    if (rawMsg.includes('503') || rawMsg.includes('high demand') || rawMsg.includes('UNAVAILABLE')) {
      userFriendlyMessage = 'Сервіс Gemini тимчасово перевантажений. Будь ласка, натисніть "Спробувати знову" через кілька секунд.';
    } else if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')) {
      userFriendlyMessage = 'Перевищено ліміт запитів до AI. Зачекайте кілька секунд та спробуйте знову.';
    } else if (rawMsg.includes('API key') || rawMsg.includes('GEMINI_API_KEY')) {
      userFriendlyMessage = 'Ключ Gemini API не знайдено або він недійсний.';
    } else if (rawMsg.includes('404') || rawMsg.includes('NOT_FOUND')) {
      userFriendlyMessage = 'Модель Gemini або ресурс не знайдено. Спробуйте повторити запит.';
    } else if (rawMsg && !rawMsg.startsWith('{')) {
      userFriendlyMessage = rawMsg;
    }

    return res.status(500).json({
      success: false,
      error: userFriendlyMessage,
      details: rawMsg,
    });
  }
});

// Start Express and Vite middleware
async function startServer() {
  const distPath = path.join(process.cwd(), 'dist');
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Invoice OCR Processor running on http://0.0.0.0:${PORT} (${isProduction ? 'Production static' : 'Development Vite'})`);
  });
}

startServer();
