import { processOcrDocument } from '../_lib/ocrEngine';

// Vercel Serverless Function Configuration
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
  maxDuration: 60,
};

export default async function handler(req: any, res: any) {
  // Setup CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: `Method ${req.method} not allowed. Please use POST.`,
    });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid JSON body' });
      }
    }

    const {
      fileData,
      mimeType,
      fileName,
      ourCompanies,
      suppliers,
      knownOrders,
      docTypeHint,
    } = body || {};

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

    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Vercel Serverless OCR Error:', error);
    let userFriendlyMessage = 'Помилка обробки документа через Gemini OCR на Vercel Serverless.';
    const rawMsg = error?.message || String(error);
    if (rawMsg.includes('503') || rawMsg.includes('high demand') || rawMsg.includes('UNAVAILABLE')) {
      userFriendlyMessage = 'Сервіс Gemini тимчасово перевантажений. Будь ласка, натисніть "Повторити" через кілька секунд.';
    } else if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')) {
      userFriendlyMessage = 'Перевищено ліміт запитів до AI. Зачекайте кілька секунд та спробуйте знову.';
    } else if (rawMsg.includes('API key') || rawMsg.includes('GEMINI_API_KEY')) {
      userFriendlyMessage = 'Ключ Gemini API не знайдено або він недійсний. Перевірте змінні середовища GEMINI_API_KEY у налаштуваннях Vercel.';
    }

    return res.status(500).json({
      success: false,
      error: userFriendlyMessage,
      details: rawMsg,
    });
  }
}
