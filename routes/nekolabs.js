const express = require('express');
const router = express.Router();
const nekolabsController = require('../controllers/nekolabsController.clean');

/**
 * @route   GET /api/nekolabs/cors
 * @desc    CORS Proxy - Bypass CORS restrictions for any image URL
 * @access  Public
 * @query   url (required) - Full URL of the image to proxy
 * 
 * @example GET /api/nekolabs/cors?url=https://api.nekolabs.web.id/f/nekoo_1764218677838.png
 */
router.get('/cors', nekolabsController.corsProxy);


/**
 * @route   GET /api/nekolabs/image
 * @desc    Generate image using NekoLabs Imagen API
 * @access  Public
 * @query   prompt (required) - Image description
 * @query   ratio (optional) - Image ratio: 1:1, 16:9, 3:4, 4:3, 9:16 (default: 1:1)
 * @query   version (optional) - API version: 3.0 or 4.0 (default: 4.0)
 * 
 * @example GET /api/nekolabs/image?prompt=A beautiful sunset&ratio=16:9&version=4.0
 */
router.get('/image', nekolabsController.generateImage);

/**
 * @route   GET /api/nekolabs/text/gemini
 * @desc    Generate text using NekoLabs Gemini 2.5 Flash API
 * @access  Public
 * @query   text (required) - Input text for generating response
 * @query   systemPrompt (optional) - Instruction for the system
 * @query   imageUrl (optional) - URL of the image to be used (recommended to use tmpfiles)
 * @query   sessionId (optional) - Unique identifier for the current session
 * @query   version (optional) - API version: v1 or v2 (default: v1)
 * 
 * @example GET /api/nekolabs/text/gemini?text=Halo&systemPrompt=Kamu adalah asisten&sessionId=123
 */
// Accept optional variant path (e.g. 2.5-pro, 2.5-flash, 2.5-flash-lite)
router.get('/text/gemini', nekolabsController.generateTextGemini);
router.get('/text/gemini/:variant', nekolabsController.generateTextGemini);

/**
 * @route   POST /api/nekolabs/text/chat
 * @desc    Chat Completion using Gemini (supports history)
 * @access  Public
 * @body    messages (required) - Array of message objects [{role: "user", content: "..."}]
 * @body    model (optional) - Model name (default: gemini-2.5-flash)
 * 
 * @example POST /api/nekolabs/text/chat
 * Body: { "messages": [{"role":"user","content":"Halo"}], "model": "gemini-2.5-flash" }
 */
router.post('/text/chat', nekolabsController.chatCompletion);

/**
 * @route   GET /api/nekolabs/text/openai
 * @desc    Generate text using NekoLabs OpenAI O3 API
 * @access  Public
 * @query   text (required) - Input text for generating response
 * @query   systemPrompt (optional) - Instruction for the system
 * @query   imageUrl (optional) - URL of the image to be used (recommended to use tmpfiles)
 * @query   sessionId (optional) - Unique identifier for the current session
 * 
 * @example GET /api/nekolabs/text/openai?text=Siapa kamu&systemPrompt=Saya adalah AI
 */
router.get('/text/openai', nekolabsController.generateTextOpenAI);

module.exports = router;
