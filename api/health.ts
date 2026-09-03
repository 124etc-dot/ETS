export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);

  return res.status(200).json({
    status: 'ok',
    hasGeminiKey,
    time: new Date().toISOString(),
    runtime: 'vercel-serverless',
  });
}
