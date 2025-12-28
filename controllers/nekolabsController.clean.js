const axios = require('axios');

const NEKOLABS_BASE_URL = 'https://api.nekolabs.web.id';

function getNekoKey(req) {
  const h = req.headers || {};
  return h['x-nekokey'] || h['X-NekoKey'] || process.env.NEKO_API_KEY || null;
}

exports.corsProxy = async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Parameter "url" diperlukan' });
    try { new URL(url); } catch (e) { return res.status(400).json({ success: false, error: 'URL tidak valid' }); }
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const contentType = response.headers['content-type'] || 'image/png';
    res.set({ 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' });
    return res.send(response.data);
  } catch (error) {
    console.error('Error proxying image:', error.message);
    if (error.response) return res.status(error.response.status).json({ success: false, error: 'Gagal mengambil gambar dari URL', details: error.message });
    if (error.code === 'ECONNABORTED') return res.status(408).json({ success: false, error: 'Request timeout' });
    return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
  }
};

exports.generateImage = async (req, res) => {
  try {
    const { prompt, ratio = '1:1', version = '4.0' } = req.query;
    if (!prompt) return res.status(400).json({ success: false, error: 'Parameter "prompt" diperlukan' });
    const validRatios = ['1:1', '16:9', '3:4', '4:3', '9:16']; if (!validRatios.includes(ratio)) return res.status(400).json({ success: false, error: `Ratio tidak valid. Gunakan salah satu: ${validRatios.join(', ')}` });
    const validVersions = ['3.0', '4.0']; if (!validVersions.includes(version)) return res.status(400).json({ success: false, error: `Version tidak valid. Gunakan: ${validVersions.join(' atau ')}` });
    // NekoLabs image endpoint format:
    //   /img.gen/imagen/3.0-fast
    //   /img.gen/imagen/4.0-fast
    const apiUrl = `${NEKOLABS_BASE_URL}/img.gen/imagen/${version}-fast`;
    const headers = {}; const nekoKey = getNekoKey(req); if (nekoKey) headers['X-NekoKey'] = nekoKey;
    const response = await axios.get(apiUrl, { params: { prompt, ratio }, headers, timeout: 30000 });
    return res.json(response.data);
  } catch (error) {
    console.error('Error generating image:', error.message);
    if (error.response) return res.status(error.response.status).json({ success: false, error: error.response.data?.error || 'Error dari NekoLabs API', details: error.response.data });
    if (error.code === 'ECONNABORTED') return res.status(408).json({ success: false, error: 'Request timeout - gambar memerlukan waktu terlalu lama untuk dibuat' });
    return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
  }
};

exports.generateTextGemini = async (req, res) => {
  try {
    const { text, systemPrompt, imageUrl, sessionId, version = 'v1' } = req.query;
    if (!text) return res.status(400).json({ success: false, error: 'Parameter "text" diperlukan' });
    const validVersions = ['v1', 'v2']; if (!validVersions.includes(version)) return res.status(400).json({ success: false, error: `Version tidak valid. Gunakan: ${validVersions.join(' atau ')}` });
    const defaultEndpoint = `text-generation/gemini/2.5-flash/${version}`;
    const variant = req.params?.variant;
    const targetPath = variant ? `text-generation/gemini/${variant}/${version}` : defaultEndpoint;
    const apiUrl = `${NEKOLABS_BASE_URL}/${targetPath}`;
    const params = { text }; if (systemPrompt) params.systemPrompt = systemPrompt; if (imageUrl) params.imageUrl = imageUrl; if (sessionId) params.sessionId = sessionId;
    const headers = {}; const nekoKey = getNekoKey(req); if (nekoKey) headers['X-NekoKey'] = nekoKey;
    const response = await axios.get(apiUrl, { params, headers, timeout: 30000 });
    return res.json(response.data);
  } catch (error) {
    console.error('Error generating text (Gemini):', error.message);
    if (error.response) return res.status(error.response.status).json({ success: false, error: error.response.data?.error || 'Error dari NekoLabs API', details: error.response.data });
    if (error.code === 'ECONNABORTED') return res.status(408).json({ success: false, error: 'Request timeout' });
    return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
  }
};

exports.chatCompletion = async (req, res) => {
  try {
    const { messages, model = 'gemini-2.5-flash', systemPrompt, sessionId, version = 'v1' } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) return res.status(400).json({ success: false, error: 'Parameter "messages" array diperlukan' });
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user'); if (!lastUserMessage) return res.status(400).json({ success: false, error: 'Minimal satu pesan dari user diperlukan' });
    const text = lastUserMessage.content;
    try {
      const validVersions = ['v1', 'v2']; const apiVersion = validVersions.includes(version) ? version : 'v1';
      const variant = req.query?.variant || req.body?.variant;
      const targetPath = variant ? `text-generation/gemini/${variant}/${apiVersion}` : `text-generation/gemini/2.5-flash/${apiVersion}`;
      const apiUrl = `${NEKOLABS_BASE_URL}/${targetPath}`;
      const params = { text }; if (systemPrompt) params.systemPrompt = systemPrompt; if (sessionId) params.sessionId = sessionId;
      const headers = {}; const nekoKey = getNekoKey(req); if (nekoKey) headers['X-NekoKey'] = nekoKey;
      const response = await axios.get(apiUrl, { params, headers, timeout: 30000 });
      return res.json({ success: true, source: 'nekolabs', version: apiVersion, ...response.data });
    } catch (nekoError) {
      console.warn('[NekoLabs] Primary API failed, trying fallback:', nekoError.message);
      const GOOGLE_API_KEY = process.env.GOOGLE_GEMINI_API_KEY; if (!GOOGLE_API_KEY) throw new Error('NekoLabs API failed and no Google API key configured');
      const geminiModel = model === 'gemini-2.5-flash-lite' ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash';
      const googleApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${GOOGLE_API_KEY}`;
      const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : m.role, parts: [{ text: m.content }] }));
      const googlePayload = { contents, generationConfig: { temperature: 0.7, maxOutputTokens: 2048 } }; if (systemPrompt) googlePayload.systemInstruction = { parts: [{ text: systemPrompt }] };
      const googleResponse = await axios.post(googleApiUrl, googlePayload, { headers: { 'Content-Type': 'application/json' }, timeout: 60000 });
      const googleData = googleResponse.data; const responseText = googleData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.json({ success: true, source: 'google-gemini', model: geminiModel, result: responseText, usage: googleData.usageMetadata });
    }
  } catch (error) {
    console.error('Error chat completion:', error.message);
    if (error.response) return res.status(error.response.status).json({ success: false, error: error.response.data?.error || 'Error dari API', details: error.response.data });
    if (error.code === 'ECONNABORTED') return res.status(408).json({ success: false, error: 'Request timeout' });
    return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
  }
};

exports.generateTextOpenAI = async (req, res) => {
  try {
    const { text, systemPrompt, imageUrl, sessionId } = req.query; if (!text) return res.status(400).json({ success: false, error: 'Parameter "text" diperlukan' });
    const apiUrl = `${NEKOLABS_BASE_URL}/text-generation/openai/o3`;
    const params = { text }; if (systemPrompt) params.systemPrompt = systemPrompt; if (imageUrl) params.imageUrl = imageUrl; if (sessionId) params.sessionId = sessionId;
    const headers = {}; const nekoKey = getNekoKey(req); if (nekoKey) headers['X-NekoKey'] = nekoKey;
    const response = await axios.get(apiUrl, { params, headers, timeout: 30000 }); return res.json(response.data);
  } catch (error) {
    console.error('Error generating text (OpenAI):', error.message);
    if (error.response) return res.status(error.response.status).json({ success: false, error: error.response.data?.error || 'Error dari NekoLabs API', details: error.response.data });
    if (error.code === 'ECONNABORTED') return res.status(408).json({ success: false, error: 'Request timeout' });
    return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
  }
};
