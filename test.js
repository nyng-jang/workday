const { solve, fixedHolidays } = require('./api/_lib/solver');
const names=['이지은','이동민','최빛나','김재명'];
const mk=(o={})=>({mustOffWeekdays:[],mustWorkWeekdays:[],mustOffDates:[],mustWorkDates:[],noConsecutiveOff:false,...o});
function run(label,y,m,cs,extra={}){
  const hol={}; for(const [k,v] of fixedHolidays(y)) if(k.startsWith(`${y}-${String(m).padStart(2,'0')}`)) hol[k]=v;
  const t=Date.now();
  const r=solve({year:y,month:m,holidays:hol,people:names.map((n,i)=>({name:n,c:mk(cs[i]||{}),carry:(extra.carry||[])[i]||0})),...extra});
  console.log(label, r.ok?`ok options=${r.options.length} ${Date.now()-t}ms T=${r.perPersonCounted}`:`FAIL ${r.error}`, r.warnings||[]);
  return r;
}
const r=run('2026-10 기본',2026,10,[]);
if(r.ok){ for(const o of r.options){ console.log(JSON.stringify(o.stats.map(s=>[s.off,s.counted,s.weekendOff,s.holidayOff])),o.score);
  // validate
  for(const d of o.days){ const w=4-d.off.length; if(w<2) throw new Error('min2 '+d.date); if((d.dow===1||d.dow===3)&&d.off.length) throw new Error('monwed '+d.date);} } }
run('일요일 무조건 휴무(이지은)+화목(이동민)',2026,10,[{mustOffWeekdays:[0]},{mustOffWeekdays:[2,4]}]);
run('휴일 떨어져야(김재명)',2026,10,[{},{},{},{noConsecutiveOff:true}]);
run('11월',2026,11,[]);
run('12월',2026,12,[]);
run('2월',2027,2,[]);
run('이월',2026,10,[],{carry:[1,0,0,0]});
run('충돌: 3명 일요일',2026,10,[{mustOffWeekdays:[0]},{mustOffWeekdays:[0]},{mustOffWeekdays:[0]}]);
