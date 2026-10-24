const weekdayNames=['日','一','二','三','四','五','六'];
const shortMonthDay='(?<!\\d)(?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\\d|3[01])(?!\\d)';
const calendarDate='(?:\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}|(?:\\d{4}年)?(?:\\d{1,2}|[一二三四五六七八九十]{1,3})月(?:\\d{1,2}|[一二三四五六七八九十]{1,3})[日号]|'+shortMonthDay+')';
const explicitBefore=new RegExp(calendarDate+'[\\s（(]*$');
const explicitAfter=new RegExp('^[\\s)）（(]*'+calendarDate);

/** Only the bare weekday that is also today is ambiguous between this and next week. */
export function sameWeekdayAmbiguity(text,today,dateEvidence='') {
  if(typeof text!=='string'||typeof today!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(today))return null;
  const time=Date.parse(today+'T00:00:00Z');
  if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==today)return null;
  if(new RegExp(calendarDate).test(dateEvidence))return null;
  const current=new Date(time).getUTCDay();
  for(const match of text.matchAll(/(?:周|星期|礼拜)([一二三四五六日天])/g)) {
    const day=['日','天'].includes(match[1])?0:weekdayNames.indexOf(match[1]);
    if(day!==current)continue;
    const before=text.slice(0,match.index).split(/[，,。；;！!？?\n]/).at(-1);
    const after=text.slice(match.index+match[0].length).split(/[，,。；;！!？?\n]/)[0];
    const qualified=/(?:今天|今日|明天|后天|[本这上下]周|下个星期|下个礼拜|本|这|上|下{1,2})(?:一个|个)?\s*(?:是|就是|的)?[\s（(]*$/.test(before)||
      /^[\s()（）]*(?:也就是|就是|是)?\s*(?:今天|今日|明天|后天)/.test(after)||explicitBefore.test(before)||explicitAfter.test(after);
    if(!qualified)return '周'+weekdayNames[current];
  }
  return null;
}

/** Keep supported non-date facts; replace every date-bearing model summary/question on ambiguity. */
export function guardSameWeekdayDates(result,{text,today}) {
  const weekday=sameWeekdayAmbiguity(text,today,result.evidence?.check_in);
  if(!weekday)return result;
  const fields={...result.fields},evidence={...result.evidence};
  for(const key of ['check_in','check_out']){delete fields[key];delete evidence[key];}
  return {...result,fields,evidence,needsDateConfirmation:true,summary:`${weekday}入住的具体日期待确认，其余明确的出行需求已保留。`,questions:[`你说的${weekday}是今天还是下周的${weekday}？`]};
}
