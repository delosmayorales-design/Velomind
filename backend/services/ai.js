const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

/**
 * Llama a un modelo de IA en cascada (Anthropic -> OpenAI -> Gemini -> Groq).
 * @param {string} systemPrompt - El prompt del sistema para la IA.
 * @param {string} userMsg - El prompt del usuario.
 * @param {object} [options] - Opciones adicionales.
 * @param {number} [options.max_tokens=4096] - Máximo de tokens en la respuesta.
 * @param {number} [options.temperature=0.3] - Temperatura de la respuesta.
 * @param {object} [options.response_format={ type: 'json_object' }] - Formato de respuesta esperado para OpenAI/Groq.
 * @returns {Promise<object>} - El objeto JSON parseado de la respuesta de la IA.
 */
async function callAI(systemPrompt, userMsg, options = {}) {
  const { max_tokens = 4096, temperature = 0.3, response_format = { type: 'json_object' } } = options;

  const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
  const openaiKey    = process.env.OPENAI_API_KEY    || '';
  const googleKey    = process.env.GOOGLE_API_KEY    || '';
  const groqKey      = process.env.GROQ_API_KEY      || '';
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (!anthropicKey && !openaiKey && !googleKey && !groqKey) {
    throw new Error('No se han configurado API Keys de IA válidas en el servidor.');
  }

  let result = null;
  let lastError = null;

  const parseJSON = (raw) => {
    if (!raw) throw new Error('Respuesta vacía del modelo');
    const m = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/s);
    if (!m) throw new Error('No se encontró JSON en la respuesta: ' + raw.substring(0, 200));
    try {
      return JSON.parse(m[1]);
    } catch (e) {
      // Intenta corregir comas finales que a veces añade la IA
      const fixedRaw = m[1].replace(/,\s*([\}\]])/g, '$1');
      try {
        return JSON.parse(fixedRaw);
      } catch (e2) {
        throw new Error('JSON inválido incluso después de intentar corregirlo.');
      }
    }
  };

  // 1. Anthropic
  if (!result && anthropicKey.startsWith('sk-ant-')) {
    try {
      const model = options.anthropicModel || 'claude-3-5-sonnet-20241022';
      const msg = await anthropic.messages.create({ model, max_tokens, system: systemPrompt, messages: [{ role: 'user', content: userMsg }] });
      result = parseJSON(msg.content?.[0]?.text);
    } catch (e) { lastError = e.message; }
  }

  // 2. OpenAI
  if (!result && openaiKey.length > 20) {
    try {
      const model = options.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` }, body: JSON.stringify({ model, max_tokens, temperature, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }], response_format }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || `OpenAI error ${r.status}`);
      result = parseJSON(d.choices?.[0]?.message?.content);
    } catch (e) { lastError = e.message; }
  }

  // 3. Google Gemini
  if (!result && googleKey.startsWith('AIzaSy')) {
    try {
      const model = options.geminiModel || GEMINI_MODEL;
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${googleKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt + '\n\n' + userMsg }] }], generationConfig: { maxOutputTokens: max_tokens, temperature, responseMimeType: 'application/json' } }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || `Gemini error ${r.status}`);
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || d.candidates?.[0]?.parts?.[0]?.text;
      result = parseJSON(text);
    } catch (e) { lastError = e.message; }
  }

  // 4. Groq
  if (!result && groqKey.startsWith('gsk_')) {
    // Lista de modelos candidatos: si Groq deprecó/renombró alguno, probamos el siguiente
    // en vez de fallar toda la petición (ver historial de decomisiones de modelos de Groq).
    const groqModels = options.groqModel
      ? [options.groqModel]
      : ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];
    // Groq free tier tiene un límite estricto de 6000 Tokens Por Minuto (TPM) sumando prompt + max_tokens.
    // Limitamos dinámicamente max_tokens a 2500 para evitar que el servidor devuelva error de Rate Limit.
    const groqMaxTokens = Math.min(max_tokens, 2500);
    for (const model of groqModels) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` }, body: JSON.stringify({ model, max_tokens: groqMaxTokens, temperature, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }], response_format }) });
        const d = await r.json();
        if (!r.ok) {
          // El modo response_format:'json_object' de Groq a veces rechaza una respuesta que
          // en realidad contiene JSON válido (o casi válido): su validador es más estricto que
          // el nuestro. El texto generado por el modelo viaja igualmente en `failed_generation`,
          // así que lo recuperamos e intentamos parsearlo nosotros antes de rendirnos.
          if (d.error?.code === 'json_validate_failed' && d.error?.failed_generation) {
            result = parseJSON(d.error.failed_generation);
            break;
          }
          throw new Error(d.error?.message || `Groq error ${r.status}`);
        }
        result = parseJSON(d.choices?.[0]?.message?.content);
        break;
      } catch (e) { lastError = e.message; }
    }
  }

  if (!result) {
    // Los mensajes de error crudos de los proveedores (ej. "Failed to validate JSON..." de
    // Groq) son texto interno en inglés pensado para desarrolladores, no para el atleta que
    // ve el toast de error en la app. Si no reconocemos el mensaje como algo accionable por
    // el usuario, mostramos un mensaje genérico en español y dejamos el original en el log.
    if (lastError) console.error('[callAI] Todos los proveedores de IA fallaron:', lastError);
    const friendly = 'El asistente de IA no pudo generar una respuesta válida esta vez. Vuelve a intentarlo en unos segundos.';
    throw new Error(lastError && !/failed to (validate|generate) json/i.test(lastError) ? lastError : friendly);
  }
  return result;
}

module.exports = { callAI };