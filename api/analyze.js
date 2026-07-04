export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not set in Vercel environment variables.' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  try {
    const { symbol, marketType, timeframe, tradeStyle, livePrice, change } = await req.json();

    const priceCtx = livePrice
      ? `CRITICAL — LIVE REAL-TIME PRICE: ${symbol} is currently trading at EXACTLY ${livePrice} (fetched live seconds ago).
ALL price levels in your response (entry, stop loss, take profits, support, resistance) MUST be numerically anchored to ${livePrice}.
Do NOT use any historical or made-up baseline. Every price you output must make sense relative to ${livePrice}.`
      : `Live price unavailable. Use a realistic current market estimate for ${symbol} and put it in the currentPrice field.`;

    const prompt = `You are TradeScope, an elite professional trading analysis AI.
Respond ONLY with a single valid JSON object. No markdown fences, no commentary — pure JSON only.

${priceCtx}

Analyze ${symbol} (${marketType}) on the ${timeframe}-minute timeframe for a ${tradeStyle} trader.
${change ? `24h change: ${change}%` : ''}

Return this exact JSON structure (all fields required):
{
  "signal": "BUY" | "SELL" | "NEUTRAL",
  "confidence": <integer 0-100>,
  "trend": "BULLISH" | "BEARISH" | "SIDEWAYS",
  "volatility": "LOW" | "MEDIUM" | "HIGH",
  "riskReward": "<e.g. 1:2.5>",
  "currentPrice": "${livePrice || 'your estimate'}",
  "entryZone": "<price or tight range anchored to ${livePrice || 'current price'}>",
  "stopLoss": "<specific price realistic for this asset>",
  "takeProfit1": "<first target>",
  "takeProfit2": "<second target>",
  "takeProfit3": "<extended target>",
  "marketBias": "<2 sentences on directional bias right now>",
  "priceAction": "<2-3 sentences on current price action and structure>",
  "keyLevels": "<2-3 sentences on key support/resistance near current price>",
  "indicators": [
    { "name": "RSI (14)", "value": "<reading>", "signal": "BUY"|"SELL"|"NEUTRAL" },
    { "name": "MACD", "value": "<reading>", "signal": "BUY"|"SELL"|"NEUTRAL" },
    { "name": "EMA 20/50", "value": "<cross status>", "signal": "BUY"|"SELL"|"NEUTRAL" },
    { "name": "Bollinger Bands", "value": "<reading>", "signal": "BUY"|"SELL"|"NEUTRAL" },
    { "name": "ATR (14)", "value": "<value>", "signal": "NEUTRAL" }
  ],
  "sessionContext": "<1-2 sentences on active session>",
  "tradeScenario": "<4-5 sentences: full step-by-step trade plan with specific prices>",
  "riskWarning": "<2 sentences on main risk to this setup>",
  "binaryNote": "<digit match strategy if binary/synthetic, else empty string>",
  "supportLevel": "<one key support price near current price>",
  "resistanceLevel": "<one key resistance price near current price>"
}`;

    // Gemini 2.0 Flash — free tier, fast
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1500,
          responseMimeType: 'application/json',   // forces Gemini to return pure JSON
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const msg = data?.error?.message || 'Gemini API error';
      return new Response(JSON.stringify({ error: msg }), {
        status: response.status, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // Extract text from Gemini response
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
}
