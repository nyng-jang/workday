'use strict';
// 근무표를 계산하기 전에 매번 호출: 해당 월의 한국 공휴일·대체공휴일·임시공휴일을 웹 검색으로 조회
const { callLLM, extractJson, checkAccess, MODEL } = require('./_lib/llm');
const { baselineFor } = require('./_lib/baseline');

module.exports = async function handler(req, res) {
  if (!checkAccess(req)) return res.status(401).json({ error: '접근 코드가 올바르지 않습니다.' });
  const q = req.method === 'POST' ? req.body || {} : req.query || {};
  const year = parseInt(q.year, 10), month = parseInt(q.month, 10);
  if (!(year >= 2024 && year <= 2035) || !(month >= 1 && month <= 12)) return res.status(400).json({ error: 'year/month 값이 올바르지 않습니다.' });

  const mm = String(month).padStart(2, '0');
  const { map: base, lunarKnown } = baselineFor(year, month);
  const warnings = [];
  if (!lunarKnown) warnings.push(`${year}년 음력 공휴일(설날·부처님오신날·추석)은 내장 데이터가 없어 검색 결과에만 의존합니다.`);

  const holidays = {};
  for (const [k, v] of base) holidays[k] = { ...v, origin: 'baseline' };
  let sources = [], verified = false, note = '';

  try {
    const baseList = [...base].map(([d, v]) => `${d} ${v.name}`).join('\n') || '(없음)';
    const { text, sources: src } = await callLLM({
      search: true, maxTokens: 3000,
      system: '당신은 대한민국 공휴일 확인 담당자입니다. 반드시 구글 검색으로 최신 정부 발표(행정안전부·인사혁신처 보도자료, 관보, 월력요항)를 확인한 뒤 답합니다. 응답은 JSON 객체 하나만 출력합니다.',
      user: `${year}년 ${month}월에 해당하는 대한민국 법정 공휴일·대체공휴일·임시공휴일·선거일(공휴일로 지정된 경우)을 모두 찾아주세요.
아래는 코드에 내장된 기본 목록입니다. 검색 결과와 대조해서 누락·추가·삭제된 것이 있는지 확인하세요.
[기본 목록]
${baseList}

출력 형식(JSON만):
{"holidays":[{"date":"YYYY-MM-DD","name":"공휴일 이름","type":"공휴일|대체공휴일|임시공휴일"}],"changes":"기본 목록과 달라진 점(없으면 빈 문자열)","confidence":"high|medium|low"}
- 해당 월의 날짜만 포함하세요. 확인되지 않은 것은 넣지 말고 confidence를 낮추세요.`,
    });
    sources = src;
    const j = extractJson(text);
    const re = new RegExp(`^${year}-${mm}-\\d{2}$`);
    for (const h of j.holidays || []) {
      if (!re.test(h.date || '')) continue;
      holidays[h.date] = { name: String(h.name || '공휴일').slice(0, 30), type: ['공휴일', '대체공휴일', '임시공휴일'].includes(h.type) ? h.type : '공휴일', origin: base.has(h.date) ? 'baseline+search' : 'search' };
    }
    verified = true;
    note = j.changes || '';
    if (j.confidence && j.confidence !== 'high') warnings.push(`검색 신뢰도 ${j.confidence}: 결과 목록을 직접 확인해 주세요.`);
    for (const [d, v] of base) if (!(j.holidays || []).some((h) => h.date === d)) warnings.push(`${d} ${v.name}: 검색 결과에는 없지만 내장 기본값이라 유지했습니다. 확인해 주세요.`);
  } catch (e) {
    warnings.push(e.code === 'NO_KEY'
      ? 'GEMINI_API_KEY가 없어 공휴일 조회를 건너뛰고 내장 기본값만 사용했습니다. 임시공휴일·선거일은 반영되지 않았습니다.'
      : `공휴일 조회에 실패해 내장 기본값만 사용했습니다 (${e.message}). 임시공휴일·선거일은 반영되지 않았을 수 있습니다.`);
  }

  res.status(200).json({ year, month, verified, holidays, sources, note, warnings, model: MODEL, checkedAt: new Date().toISOString() });
};
