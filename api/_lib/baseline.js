'use strict';
// 내장 기본 공휴일: 고정 공휴일(자동 계산) + 음력 공휴일(2026·2027만 내장, 확인 필요)
// 선거일·임시공휴일은 정부 발표 후 결정되므로 반드시 LLM 조회로 보완한다.
const { fixedHolidays } = require('./solver');

const LUNAR = {
  2026: [
    ['2026-02-16', '설날 연휴', '공휴일'], ['2026-02-17', '설날', '공휴일'], ['2026-02-18', '설날 연휴', '공휴일'],
    ['2026-05-24', '부처님오신날', '공휴일'], ['2026-05-25', '부처님오신날 대체공휴일', '대체공휴일'],
    ['2026-09-24', '추석 연휴', '공휴일'], ['2026-09-25', '추석', '공휴일'], ['2026-09-26', '추석 연휴', '공휴일'],
  ],
  2027: [
    ['2027-02-06', '설날 연휴', '공휴일'], ['2027-02-07', '설날', '공휴일'], ['2027-02-08', '설날 연휴', '공휴일'],
    ['2027-02-09', '설날 대체공휴일', '대체공휴일'],
    ['2027-05-13', '부처님오신날', '공휴일'],
    ['2027-09-14', '추석 연휴', '공휴일'], ['2027-09-15', '추석', '공휴일'], ['2027-09-16', '추석 연휴', '공휴일'],
  ],
};

function baselineFor(year, month) {
  const mm = String(month).padStart(2, '0');
  const map = new Map();
  for (const [k, v] of fixedHolidays(year)) if (k.startsWith(`${year}-${mm}-`)) map.set(k, v);
  for (const [k, name, type] of LUNAR[year] || []) if (k.startsWith(`${year}-${mm}-`)) map.set(k, { name, type });
  return { map, lunarKnown: !!LUNAR[year] };
}
module.exports = { baselineFor };
