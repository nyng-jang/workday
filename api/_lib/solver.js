'use strict';
// 근무표 계산 로직 (LLM 없이 규칙을 코드로 보장)
// 규칙: 주 2일 휴무(주 5일 근무), 하루 최소 2명 근무, 월·수 전원 출근,
//       공휴일과 겹친 휴무는 휴무 일수로 치지 않고 대체휴무를 추가 부여(B안)

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dowOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일 … 6=토
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function weekStart(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); // 월요일 시작
  return dt.toISOString().slice(0, 10);
}
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, r) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const pop = (m) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };
const variance = (a) => { const mu = a.reduce((x, y) => x + y, 0) / a.length; return a.reduce((s, x) => s + (x - mu) ** 2, 0) / a.length; };

// 법정 고정 공휴일 + 대체공휴일 (음력 공휴일·임시공휴일은 제외 → LLM 조회로 보완)
function fixedHolidays(y) {
  const base = [
    [1, 1, '신정', 0], [3, 1, '삼일절', 1], [5, 5, '어린이날', 1], [6, 6, '현충일', 0],
    [8, 15, '광복절', 1], [10, 3, '개천절', 1], [10, 9, '한글날', 1], [12, 25, '기독탄신일', 1],
  ];
  const map = new Map();
  for (const [m, d, name] of base) map.set(ymd(y, m, d), { name, type: '공휴일' });
  for (const [m, d, name, sub] of base) {
    if (!sub) continue;
    const w = dowOf(y, m, d);
    if (w !== 0 && w !== 6) continue;
    const c = new Date(Date.UTC(y, m - 1, d));
    do { c.setUTCDate(c.getUTCDate() + 1); }
    while ([0, 6].includes(c.getUTCDay()) || map.has(c.toISOString().slice(0, 10)));
    map.set(c.toISOString().slice(0, 10), { name: `${name} 대체공휴일`, type: '대체공휴일' });
  }
  return map;
}

function solve({ year, month, holidays, people, comp = 1, deadlineMs = 4000, want = 3 }) {
  const P = people.length;
  const n = daysIn(year, month);
  const warnings = [];

  // 날짜·주 구성 (주는 월~일, 월 경계에 걸친 주는 부분 주)
  const days = [], weekIdx = new Map(), weeks = [];
  for (let d = 1; d <= n; d++) {
    const date = ymd(year, month, d), w = dowOf(year, month, d), ws = weekStart(year, month, d);
    if (!weekIdx.has(ws)) { weekIdx.set(ws, weeks.length); weeks.push({ idx: [] }); }
    const wi = weekIdx.get(ws);
    weeks[wi].idx.push(d - 1);
    days.push({ d, date, dow: w, hol: holidays[date] || null, wi });
  }
  weeks.forEach((w) => { w.base = Math.round((2 * w.idx.length) / 7); });
  const T = weeks.reduce((a, w) => a + w.base, 0) + comp; // 1인당 이번 달 '인정 휴무' 수 (기본값)
  // 이월 보정: 지금까지 공휴일 겹침으로 추가 휴무를 더 받은 사람은 이번 달 인정 휴무를 줄여 연간 총량을 맞춘다 (최대 comp일)
  const carries = people.map((pp) => Number(pp.carry) || 0);
  const minCarry = Math.min(...carries);
  const Tp = carries.map((c) => T - Math.min(c - minCarry, comp));

  // 날짜별 허용 휴무 조합
  const options = [];
  const warnSet = new Set();
  for (let i = 0; i < n; i++) {
    const day = days[i];
    let F = 0, W = 0;
    for (let p = 0; p < P; p++) {
      const c = people[p].c;
      const off = c.mustOffWeekdays.includes(day.dow) || c.mustOffDates.includes(day.date);
      let work = c.mustWorkWeekdays.includes(day.dow) || c.mustWorkDates.includes(day.date);
      if (off && work) { warnSet.add(`${people[p].name}: ${day.date} 휴무·근무 조건이 충돌해 휴무를 우선했습니다.`); work = false; }
      if (off) F |= 1 << p;
      if (work) W |= 1 << p;
    }
    if (pop(F) > P - 2) {
      return { ok: false, error: `${day.date}(${DOW[day.dow]}): 휴무 요청이 ${pop(F)}명이라 하루 최소 2명 근무 규칙을 지킬 수 없습니다.`, warnings };
    }
    const monWed = day.dow === 1 || day.dow === 3;
    if (monWed && F) warnSet.add(`월·수 전원 출근 규칙과 충돌하는 휴무 요청이 있어 예외로 허용했습니다 (${day.date}).`);
    const opts = [];
    for (let m = 0; m < 1 << P; m++) {
      if (pop(m) > P - 2) continue;
      if ((m & F) !== F || (m & W) !== 0) continue;
      if (monWed && m !== F) continue;
      opts.push(m);
    }
    if (!opts.length) return { ok: false, error: `${day.date}: 가능한 조합이 없습니다 (조건 충돌).`, warnings };
    options.push(opts);
  }
  warnings.push(...warnSet);

  // 가지치기용 누적 배열
  const canOff = (p, i) => !days[i].hol && options[i].some((m) => (m >> p) & 1);
  const sufAll = [], wkSuf = [];
  for (let p = 0; p < P; p++) {
    const a = new Array(n + 1).fill(0), b = new Array(n + 1).fill(0);
    for (let i = n - 1; i >= 0; i--) a[i] = a[i + 1] + (canOff(p, i) ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const idx = weeks[days[i].wi].idx;
      let c = 0;
      for (const j of idx) if (j > i && canOff(p, j)) c++;
      b[i] = c;
    }
    sufAll.push(a); wkSuf.push(b);
  }
  const capSuffix = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    capSuffix[i] = capSuffix[i + 1] + (days[i].hol ? 0 : Math.max(...options[i].map(pop)));
  }

  function attempt(r, limit) {
    const cnt = new Array(P).fill(0);
    const wk = weeks.map(() => new Array(P).fill(0));
    const mask = new Array(n).fill(0);
    let nodes = 0;
    function rec(i) {
      if (i === n) return cnt.every((c, p) => c === Tp[p]);
      if (++nodes > limit) return false;
      const day = days[i], wi = day.wi;
      const idx = weeks[wi].idx, lastOfWeek = idx[idx.length - 1] === i;
      const opts = shuffle(options[i].slice(), r);
      if (day.hol) opts.sort((a, b) => pop(a) - pop(b));
      for (const m of opts) {
        let ok = true;
        for (let p = 0; p < P && ok; p++) {
          const off = (m >> p) & 1;
          if (!off) continue;
          if (people[p].c.noConsecutiveOff && i > 0 && ((mask[i - 1] >> p) & 1)) ok = false;
          if (!day.hol && (cnt[p] + 1 > Tp[p] || wk[wi][p] + 1 > weeks[wi].base + comp)) ok = false;
        }
        if (!ok) continue;
        for (let p = 0; p < P; p++) if (((m >> p) & 1) && !day.hol) { cnt[p]++; wk[wi][p]++; }
        mask[i] = m;
        let good = true, need = 0;
        for (let p = 0; p < P; p++) {
          const nd = Tp[p] - cnt[p];
          need += nd;
          if (nd > sufAll[p][i + 1]) good = false;
          if (weeks[wi].base - wk[wi][p] > wkSuf[p][i]) good = false;
        }
        if (good && need > capSuffix[i + 1]) good = false;
        if (good && lastOfWeek) for (let p = 0; p < P; p++) if (wk[wi][p] < weeks[wi].base) good = false;
        if (good && rec(i + 1)) return true;
        for (let p = 0; p < P; p++) if (((m >> p) & 1) && !day.hol) { cnt[p]--; wk[wi][p]--; }
        mask[i] = 0;
        if (nodes > limit) return false;
      }
      return false;
    }
    return rec(0) ? mask.slice() : null;
  }

  // 무작위 재시작으로 여러 해를 수집
  const rng = mulberry((Date.now() ^ 0x9e3779b9) >>> 0);
  const found = new Map();
  const deadline = Date.now() + deadlineMs;
  let tries = 0;
  while (Date.now() < deadline && found.size < 80 && tries < 4000) {
    tries++;
    const m = attempt(rng, 6000);
    if (m) found.set(m.join(','), m);
  }
  if (!found.size) {
    return { ok: false, error: '입력한 특이사항을 모두 만족하는 근무표를 찾지 못했습니다. 조건이 서로 충돌하거나 너무 빡빡할 수 있습니다.', warnings };
  }

  const civilOff = days.filter((x) => x.dow === 0 || x.dow === 6 || x.hol).length;
  function evaluate(mask) {
    const st = people.map((pp) => ({ name: pp.name, off: 0, counted: 0, weekendOff: 0, holidayOff: 0 }));
    days.forEach((day, i) => {
      for (let p = 0; p < P; p++) {
        if (!((mask[i] >> p) & 1)) continue;
        st[p].off++;
        if (day.dow === 0 || day.dow === 6) st[p].weekendOff++;
        if (day.hol) st[p].holidayOff++; else st[p].counted++;
      }
    });
    st.forEach((s) => { s.work = n - s.off; });
    const score = variance(st.map((s) => s.weekendOff)) * 2
      + st.reduce((a, s) => a + s.holidayOff, 0) * 0.5
      + variance(st.map((s) => s.holidayOff));
    return { score, stats: st };
  }
  const evaluated = [...found.values()].map((mask) => ({ mask, ...evaluate(mask) })).sort((a, b) => a.score - b.score);
  const picked = [];
  const minDiff = Math.max(4, Math.round(n * P * 0.1));
  for (const e of evaluated) {
    if (picked.length >= want) break;
    const diff = (a, b) => { let c = 0; for (let i = 0; i < n; i++) c += pop(a[i] ^ b[i]); return c; };
    if (picked.every((q) => diff(q.mask, e.mask) >= minDiff)) picked.push(e);
  }
  if (!picked.length) picked.push(evaluated[0]);

  return {
    ok: true, warnings, civilOff, perPersonCounted: Tp,
    options: picked.map((e) => ({
      score: Math.round(e.score * 100) / 100,
      stats: e.stats,
      days: days.map((day, i) => ({
        date: day.date, dow: day.dow, hol: day.hol,
        off: people.map((_, p) => p).filter((p) => (e.mask[i] >> p) & 1),
      })),
    })),
  };
}

module.exports = { solve, fixedHolidays, pad, ymd, daysIn, dowOf, DOW };
