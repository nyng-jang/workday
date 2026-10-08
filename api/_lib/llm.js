'use strict';
// Gemini API 호출 헬퍼 (서버에서만 실행 — API 키는 환경변수 GEMINI_API_KEY)
// 기본 모델은 gemini-3.5-flash-lite 하나만 사용한다. GEMINI_MODEL 로 바꿀 수 있고,
// 대체 모델이 필요하면 GEMINI_FALLBACK_MODELS 에 쉼표로 구분해 적는다 (기본값: 없음).
const MODELS = [process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  ...(process.env.GEMINI_FALLBACK_MODELS || '').split(',').map((m) => m.trim()).filter(Boolean)]
  .filter((m, i, a) => a.indexOf(m) === i);
const MODEL = MODELS[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

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

  const t0 = Date.now(), BUDGET = 45000; // Vercel 함수 제한(60초) 안에서 끝내기 위한 총 시간
  const errors = [];
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() - t0 > BUDGET) break;
      let res, data;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
        });
        data = await res.json().catch(() => ({}));
      } catch (e) { errors.push(`${model}: 네트워크 오류 ${e.message}`); await sleep(1500); continue; }
      if (res.ok) {
        const cand = data.candidates?.[0];
        const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
        if (!text) { errors.push(`${model}: 빈 응답${cand?.finishReason ? `(${cand.finishReason})` : ''}`); break; }
        const sources = [];
        for (const c of cand?.groundingMetadata?.groundingChunks || []) {
          const w = c.web; if (w?.uri && !sources.some((x) => x.url === w.uri)) sources.push({ title: w.title || w.uri, url: w.uri });
        }
        return { text, sources, model };
      }
      const msg = data?.error?.message || 'unknown error';
      errors.push(`${model} ${res.status}: ${msg.split('\n')[0].slice(0, 160)}`);
      if (res.status === 400 && /API key|API_KEY/i.test(msg)) throw new Error(`Gemini API 400: ${msg} (Google AI Studio에서 발급한 Gemini 키인지 확인하세요)`);
      if (res.status === 401 || res.status === 403) throw new Error(`Gemini API ${res.status}: ${msg} (키 권한을 확인하세요)`);
      if (res.status === 404) break;                       // 모델 이름 오류 → 다음 모델
      if (res.status === 429 && attempt === 0 && /per minute|PerMinute|retry/i.test(msg)) { await sleep(3000); continue; }
      if (res.status === 429) break;                       // 일일 한도 등 → 재시도해도 소용없으니 다음 모델
      if (RETRYABLE.has(res.status) && attempt === 0) { await sleep(2000); continue; }
      break;
    }
  }
  const quota = errors.some((e) => / 429:/.test(e));
  throw new Error(`Gemini 호출에 모두 실패했습니다. ${quota ? '[사용 한도 초과 가능성: https://ai.dev/rate-limit 에서 확인] ' : ''}시도 내역: ${errors.join(' / ')}`);
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
