'use strict';
// Gemini API 호출 헬퍼 (서버에서만 실행 — API 키는 환경변수 GEMINI_API_KEY)
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

async function callLLM({ system, user, search = false, json = false, maxTokens = 4000 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { const e = new Error('GEMINI_API_KEY 환경변수가 설정되어 있지 않습니다.'); e.code = 'NO_KEY'; throw e; }
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1 },
  };
  if (search) body.tools = [{ google_search: {} }];       // 구글 검색 근거 사용 (검색 도구와 JSON 모드는 함께 쓸 수 없음)
  else if (json) body.generationConfig.responseMimeType = 'application/json';

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || 'unknown error';
    const bad = /API key|API_KEY|permission|PERMISSION/i.test(msg) || res.status === 401 || res.status === 403;
    throw new Error(`Gemini API ${res.status}: ${msg}${bad ? ' (키가 Google AI Studio에서 발급한 Gemini 키인지 확인하세요)' : ''}`);
  }
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new Error(`Gemini 응답이 비어 있습니다${cand?.finishReason ? ` (사유: ${cand.finishReason})` : ''}.`);
  const sources = [];
  for (const c of cand?.groundingMetadata?.groundingChunks || []) {
    const w = c.web; if (w?.uri && !sources.some((s) => s.url === w.uri)) sources.push({ title: w.title || w.uri, url: w.uri });
  }
  return { text, sources };
}

function extractJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('모델 응답에서 JSON을 찾지 못했습니다.');
  return JSON.parse(text.slice(a, b + 1));
}

function checkAccess(req) {
  const need = process.env.ACCESS_CODE;
  if (!need) return true;
  return req.headers['x-access-code'] === need;
}

module.exports = { callLLM, extractJson, checkAccess, MODEL };
