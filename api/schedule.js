'use strict';
// 인물별 특이사항(자연어) → LLM이 제약 조건으로 해석 → 코드가 근무표 계산
const { callLLM, extractJson, checkAccess } = require('./_lib/llm');
const { solve, DOW, daysIn } = require('./_lib/solver');

const NAMES = ['이지은', '이동민', '최빛나', '김재명'];
const emptyC = () => ({ mustOffWeekdays: [], mustWorkWeekdays: [], mustOffDates: [], mustWorkDates: [], noConsecutiveOff: false });

function cleanC(raw, year, month) {
  const mm = String(month).padStart(2, '0'), re = new RegExp(`^${year}-${mm}-\\d{2}$`);
  const n = daysIn(year, month);
  const wd = (a) => [...new Set((Array.isArray(a) ? a : []).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))];
  const dt = (a) => [...new Set((Array.isArray(a) ? a : []).filter((x) => re.test(x) && Number(x.slice(8)) <= n))];
  return { mustOffWeekdays: wd(raw?.mustOffWeekdays), mustWorkWeekdays: wd(raw?.mustWorkWeekdays), mustOffDates: dt(raw?.mustOffDates), mustWorkDates: dt(raw?.mustWorkDates), noConsecutiveOff: !!raw?.noConsecutiveOff };
}

function buildQuestion(year, month, notes) {
  const lines = NAMES.map((n) => `- ${n}: ${(notes[n] || '').trim() || '(특이사항 없음)'}`).join('\n');
  return `${year}년 ${month}월 임기제 직원 4명의 특이사항입니다. 각 문장을 아래 조건 필드로 변환해 주세요.
${lines}

필드(요일은 0=일,1=월,2=화,3=수,4=목,5=금,6=토):
- mustOffWeekdays: 매주 반드시 쉬어야 하는 요일
- mustWorkWeekdays: 매주 반드시 근무해야 하는 요일
- mustOffDates: 반드시 쉬어야 하는 날짜(YYYY-MM-DD)
- mustWorkDates: 반드시 근무해야 하는 날짜(YYYY-MM-DD)
- noConsecutiveOff: "휴일이 떨어져 있어야 함", "연속 휴무 불가" 같은 요청이면 true
- unparsed: 위 필드로 표현할 수 없는 요청 원문(예: "휴일이 붙어 있어야 함", 모호한 표현)
날짜가 "15일"처럼 일만 있으면 ${year}-${String(month).padStart(2, '0')}-15 형식으로 바꿉니다.
출력은 JSON만: {"people":{"이지은":{...},"이동민":{...},"최빛나":{...},"김재명":{...}}}`;
}

module.exports = async function handler(req, res) {
  if (!checkAccess(req)) return res.status(401).json({ error: '접근 코드가 올바르지 않습니다.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원합니다.' });
  const b = req.body || {};
  const year = parseInt(b.year, 10), month = parseInt(b.month, 10);
  if (!(year >= 2024 && year <= 2035) || !(month >= 1 && month <= 12)) return res.status(400).json({ error: 'year/month 값이 올바르지 않습니다.' });
  const comp = Math.max(0, Math.min(3, parseInt(b.comp, 10) || 0));
  const notes = {};
  for (const n of NAMES) notes[n] = String((b.notes || {})[n] || '').slice(0, 800);
  const holidays = {};
  const mm = String(month).padStart(2, '0');
  for (const [d, v] of Object.entries(b.holidays || {})) if (d.startsWith(`${year}-${mm}-`)) holidays[d] = { name: String(v.name || '공휴일').slice(0, 30), type: v.type || '공휴일' };

  const question = buildQuestion(year, month, notes);
  const parsed = {}, unparsed = {};
  NAMES.forEach((n) => { parsed[n] = emptyC(); unparsed[n] = []; });

  if (NAMES.some((n) => notes[n].trim())) {
    try {
      const { text } = await callLLM({
        system: '당신은 근무표 제약 조건 변환기입니다. 사용자가 적은 특이사항을 지정된 JSON 필드로만 변환하고, 추측해서 조건을 만들지 않습니다. JSON 객체 하나만 출력합니다.',
        user: question, json: true, maxTokens: 3000,
      });
      const j = extractJson(text);
      for (const n of NAMES) {
        const r = j.people?.[n];
        parsed[n] = cleanC(r, year, month);
        unparsed[n] = (Array.isArray(r?.unparsed) ? r.unparsed : []).map(String).slice(0, 5);
      }
    } catch (e) {
      return res.status(502).json({ error: `특이사항 해석에 실패했습니다: ${e.message}`, question });
    }
  }

  const people = NAMES.map((n) => ({ name: n, c: parsed[n], carry: Number((b.carry || {})[n]) || 0 }));
  const result = solve({ year, month, holidays, people, comp, deadlineMs: 5000, want: 3 });
  res.status(200).json({ year, month, question, parsed, unparsed, holidays, comp, dowNames: DOW, ...result });
};
