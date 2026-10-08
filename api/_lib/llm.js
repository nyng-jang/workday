'use strict';
// Anthropic Messages API 호출 헬퍼 (서버에서만 실행 — API 키는 환경변수)
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

async function callClaude({ system, user, search = false, maxTokens = 2000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { const e = new Error('ANTHROPIC_API_KEY 환경변수가 설정되어 있지 않습니다.'); e.code = 'NO_KEY'; throw e; }
  const messages = [{ role: 'user', content: user }];
  const sources = [];
  let text = '';
  for (let turn = 0; turn < 4; turn++) {
    const body = { model: MODEL, max_tokens: maxTokens, system, messages };
    if (search) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4, user_location: { type: 'approximate', country: 'KR', timezone: 'Asia/Seoul' } }];
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${data?.error?.message || 'unknown error'}`);
    text = '';
    for (const b of data.content || []) {
      if (b.type === 'text') text += b.text;
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content) if (r.url && !sources.some((s) => s.url === r.url)) sources.push({ title: r.title || r.url, url: r.url });
      }
    }
    if (data.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: data.content }); continue; }
    break;
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

module.exports = { callClaude, extractJson, checkAccess, MODEL };
