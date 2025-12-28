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
    const { text, systemPrompt, imageUrl, sessionId } = req.query;
    if (!text) return res.status(400).json({ success: false, error: 'Parameter "text" diperlukan' });
    const variant = req.params?.variant || '2.5-flash';
    // Upstream NekoLabs Gemini endpoints are under /txt.gen/gemini/<variant>
    // Examples: /txt.gen/gemini/2.5-flash, /txt.gen/gemini/2.5-pro, /txt.gen/gemini/2.5-flash-lite
    const apiUrl = `${NEKOLABS_BASE_URL}/txt.gen/gemini/${variant}`;
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
    const { messages, model = 'gemini-2.5-flash', systemPrompt, sessionId } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'Parameter \"messages\" array diperlukan' });
    }

    // Model mapping: "gemini-2.5-flash" -> "2.5-flash", "gemini-2.5-pro" -> "2.5-pro", "gemini-3.0" -> "3.0"
    const variantFromModel = typeof model === 'string' && model.startsWith('gemini-') ? model.slice('gemini-'.length) : null;
    const variant = req.query?.variant || req.body?.variant || variantFromModel || '2.5-flash';

    // No upstream chat endpoint: we convert message history into a single prompt and use Gemini text generation.
    const parts = [];
    for (const m of messages) {
      if (!m || typeof m.content !== 'string') continue;
      const role = m.role === 'assistant' ? 'Assistant' : (m.role === 'system' ? 'System' : 'User');
      parts.push(`${role}: ${m.content}`);
    }
    const text = parts.length ? parts.join('\n') : '';
    if (!text) return res.status(400).json({ success: false, error: 'Minimal satu pesan valid diperlukan' });

    const apiUrl = `${NEKOLABS_BASE_URL}/txt.gen/gemini/${variant}`;
    const params = { text };
    if (systemPrompt) params.systemPrompt = systemPrompt;
    if (sessionId) params.sessionId = sessionId;

    const headers = {};
    const nekoKey = getNekoKey(req);
    if (nekoKey) headers['X-NekoKey'] = nekoKey;

    const response = await axios.get(apiUrl, { params, headers, timeout: 60000 });
    return res.json(response.data);
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
