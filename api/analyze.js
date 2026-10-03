export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TF_LABELS = {
  '1': '1-minute', '5': '5-minute', '15': '15-minute',
  '60': '1-hour', '240': '4-hour', 'D': 'daily',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'GEMINI_API_KEY not set in Vercel environment variables.' }, 500);

  // Change the model in Vercel settings instead of editing code
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  try {
    const { symbol, marketType, timeframe, tradeStyle, livePrice, change } = await req.json();
    const tfLabel = TF_LABELS[timeframe] || `${timeframe}-minute`;

    const priceCtx = livePrice
      ? `CRITICAL — LIVE REAL-TIME PRICE: ${symbol} is currently trading at EXACTLY ${livePrice} (fetched live seconds ago).
ALL price levels in your response (entry, stop loss, take profits, support, resistance) MUST be numerically anchored to ${livePrice}.
Do NOT use any historical or made-up baseline. Every price you output must make sense relative to ${livePrice}.`
      : `Live price unavailable. Use a realistic current market estimate for ${symbol} and put it in the currentPrice field.`;

    const prompt = `You are TradeScope, an elite professional trading analysis AI.
Respond ONLY with a single valid JSON object. No markdown fences, no commentary — pure JSON only.

${priceCtx}

Analyze ${symbol} (${marketType}) on the ${tfLabel} timeframe for a ${tradeStyle} trader.
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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return json({ error: data?.error?.message || 'Gemini API error' }, response.status);
    }

    // Join all text parts (newer models can return more than one part)
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || '').join('') || '{}';

    return json({ text });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
