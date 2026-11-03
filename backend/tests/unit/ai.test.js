const { callAI } = require('../../services/ai');

const jsonResponse = (status, body) => ({ status, ok: status < 400, json: async () => body });
const geminiOk = jsonResponse(200, { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
const geminiBusy = jsonResponse(503, { error: { message: 'This model is currently experiencing high demand.' } });
const groqOk = jsonResponse(200, { choices: [{ message: { content: '{"ok":true}' } }] });
const groqTruncated = jsonResponse(400, {
  error: { code: 'json_validate_failed', message: 'Failed to validate JSON.', failed_generation: 'max completion tokens reached before generating a valid document' },
});

describe('callAI', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GOOGLE_API_KEY: 'AIzaSy-test', GROQ_API_KEY: 'gsk_test' };
    global.fetch = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('reintenta Gemini una vez tras un 503 sin pasar a Groq', async () => {
    global.fetch.mockResolvedValueOnce(geminiBusy).mockResolvedValueOnce(geminiOk);
    await expect(callAI('sys', 'user')).resolves.toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls.every(([url]) => url.includes('generativelanguage'))).toBe(true);
  });

  test('si Gemini sigue con 503 pasa a Groq con razonamiento bajo en gpt-oss', async () => {
    global.fetch.mockResolvedValueOnce(geminiBusy).mockResolvedValueOnce(geminiBusy).mockResolvedValueOnce(groqOk);
    await expect(callAI('sys', 'user')).resolves.toEqual({ ok: true });
    const body = JSON.parse(global.fetch.mock.calls[2][1].body);
    expect(body.model).toMatch(/^openai\/gpt-oss/);
    expect(body.reasoning_effort).toBe('low');
  });

  test('no envía reasoning_effort a otros modelos de Groq', async () => {
    process.env.GOOGLE_API_KEY = '';
    global.fetch.mockResolvedValueOnce(groqOk);
    await callAI('sys', 'user', { groqModel: 'otro-modelo' });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).not.toHaveProperty('reasoning_effort');
  });

  test('si todos fallan muestra el mensaje en español, no el error crudo del proveedor', async () => {
    process.env.GOOGLE_API_KEY = '';
    global.fetch.mockResolvedValue(groqTruncated);
    await expect(callAI('sys', 'user')).rejects.toThrow('El asistente de IA no pudo generar una respuesta válida');
    expect(console.error.mock.calls[0][1]).toContain('max completion tokens reached');
  });
});
