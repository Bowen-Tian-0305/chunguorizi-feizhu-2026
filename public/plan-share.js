const LIMIT = 24000;
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000 ? value : null;
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? value : null;
}
const clock = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
function mapLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname !== 'uri.amap.com' || url.pathname !== '/marker') return null;
    const position = url.searchParams.get('position') || '';
    if (!/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(position)) return null;
    const [longitude, latitude] = position.split(',').map(Number);
    if (Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
    const safe = new URL('https://uri.amap.com/marker');
    safe.searchParams.set('position', position);
    safe.searchParams.set('name', text(url.searchParams.get('name'),200));
    return safe.href;
  } catch { return null; }
}

/** Explicit public fields only. Never spread a plan, quote, POI, or user input into a share. */
export function sanitizePlanSnapshot(input) {
  const checkIn = date(input?.checkIn), checkOut = date(input?.checkOut);
  if (!checkIn || !checkOut || checkOut <= checkIn || Date.parse(checkOut) - Date.parse(checkIn) > 30 * 86400000 || !text(input?.hotel?.name, 200)) throw new TypeError('请先补齐本次酒店和有效日期');
  const adults = input.party?.adults, children = input.party?.children;
  if (!Number.isInteger(adults) || adults < 1 || adults > 12 || !Number.isInteger(children) || children < 0 || children > 8 || !Array.isArray(input.slots) || input.slots.length > 90) throw new TypeError('同行人数或餐次范围无效');
  const seen = new Set();
  const slots = input.slots.map(slot => {
    const day = date(slot?.date), meal = slot?.meal || 'breakfast', key = day + '|' + meal;
    if (!day || day < checkIn || day > checkOut || !['breakfast','lunch','dinner'].includes(meal) || seen.has(key)) throw new TypeError('餐次日期、类型或重复记录无效');
    seen.add(key);
    const time = slot.time || slot.tentativeTime;
    const start = clock(time?.start), end = clock(time?.end);
    const validTime = start && end && end > start;
    return {date:day,meal,name:text(slot.name,200) || '地点待选',address:text(slot.address,400),status:['scheduled','pending','unresolved','locked-conflict','skipped'].includes(slot.status) ? slot.status : 'pending',locked:slot.locked === true,time:validTime ? {start,end,leaveHotel:clock(time.leaveHotel),returnHotel:clock(time.returnHotel)} : null,tentative:slot.tentative === true || !slot.time,mapUrl:mapLink(slot.mapUrl || slot.map_url),adultPrice:money(slot.adultPrice)};
  });
  const cost = input.cost || {};
  return {version:1,title:'纯过日子｜一起把饭算明白',hotel:{name:text(input.hotel.name,200),address:text(input.hotel.address,400)},checkIn,checkOut,party:{adults,children},demo:input.demo === true || cost.quotesIncludeDemo === true,slots,cost:{knownAmount:money(cost.knownAmount),budgetAmount:money(cost.budgetAmount),unknownCount:Array.isArray(cost.unknownAmounts) ? Math.min(cost.unknownAmounts.length,999) : Number.isInteger(cost.unknownCount) && cost.unknownCount >= 0 ? Math.min(cost.unknownCount,999) : null,scope:['adult-meals-increment-excludes-room-price','adult-breakfast-increment-excludes-room-price','whole-stay-room-plus-listed-adult-meals'].includes(cost.scope) ? cost.scope : 'unspecified'}};
}

export function encodePlanSnapshot(input) {
  const bytes = new TextEncoder().encode(JSON.stringify(sanitizePlanSnapshot(input)));
  if (bytes.length > 18000) throw new RangeError('分享内容太长，请减少餐次后重试');
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function decodePlanSnapshot(token) {
  if (typeof token !== 'string' || !token.length || token.length > LIMIT || !/^[A-Za-z0-9_-]+$/.test(token)) throw new TypeError('分享链接不完整或内容过长');
  try {
    const raw = atob(token.replace(/-/g,'+').replace(/_/g,'/'));
    const input = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));
    if (input?.version !== 1) throw new TypeError();
    return sanitizePlanSnapshot(input);
  } catch { throw new TypeError('分享内容无法读取，请向分享者索取新链接'); }
}
export function createPlanShareUrl(input, baseUrl) {
  const base = new URL(baseUrl);
  if (base.username || base.password || !(base.protocol === 'https:' || base.protocol === 'http:' && ['localhost','127.0.0.1'].includes(base.hostname))) throw new TypeError('分享需要安全的网站地址');
  const target = new URL('/share.html',base.origin);
  target.hash = 'plan=' + encodePlanSnapshot(input);
  return target.href;
}

export function renderSharedPlan(root, snapshot) {
  const data = sanitizePlanSnapshot(snapshot);
  root.replaceChildren();
  const node = (tag, value, parent=root) => {const element=document.createElement(tag);element.textContent=value;parent.append(element);return element;};
  node('p', data.demo ? '同行只读快照 · 示例输入' : '同行只读快照');
  node('h1',data.hotel.name);node('p',data.hotel.address);
  node('p',`${data.checkIn} 至 ${data.checkOut} · ${data.party.adults}位成人 / ${data.party.children}位儿童`);
  node('p','这是分享者保存的安排，不是实时库存、供餐或食物安全保证。链接内容可被持有者查看和转发；原始订单、录音和私人备注未包含。');
  const costs = node('section','');costs.className='share-costs';
  const amount = value => value === null ? '待核' : `¥${value.toLocaleString('zh-CN')}`;
  node('h2','这份安排算了什么',costs);
  const scope = data.cost.scope === 'whole-stay-room-plus-listed-adult-meals' ? '全程房费与所列成人用餐' : data.cost.scope === 'adult-breakfast-increment-excludes-room-price' ? '基础房费之外的成人早餐增量' : data.cost.scope === 'adult-meals-increment-excludes-room-price' ? '基础房费之外的成人三餐增量' : '费用范围未说明，请向分享者核对';
  node('p',scope,costs);node('p',`${data.demo?'示例已知金额':'分享者记录的已核金额'} ${amount(data.cost.knownAmount)} · 预算 ${amount(data.cost.budgetAmount)} · 未知金额 ${data.cost.unknownCount === null ? '待核' : `${data.cost.unknownCount}项`}`,costs);
  node('small','预算不是商家报价；未列交通、未知儿童餐费等不计为零。',costs);
  const states={scheduled:'分享者标记供餐与时间已核',pending:'待核对',unresolved:'地点待选','locked-conflict':'选择存在冲突',skipped:'不在行程内'};
  for(const slot of data.slots){
    const article=node('article','');node('p',`${slot.date} · ${{breakfast:'早餐',lunch:'午餐',dinner:'晚餐'}[slot.meal]}`,article);
    node('h2',slot.name,article);if(slot.address)node('p',slot.address,article);
    node('p',states[slot.status]+(slot.locked?' · 分享者已锁定':''),article);
    if(slot.time)node('p',`${slot.tentative?'参考时段':'记录时段'} ${slot.time.start}–${slot.time.end}`,article);
    if(slot.mapUrl){const link=node('a','在地图查看具体分店 ↗',article);link.href=slot.mapUrl;link.target='_blank';link.rel='noopener noreferrer';}
  }
  const back=node('a','我也做一份吃住方案 →');back.href='/';back.className='share-back';
}

if(typeof document !== 'undefined' && document.getElementById('sharedPlan')) {
  const root=document.getElementById('sharedPlan');
  const renderCurrent = () => {
    try {renderSharedPlan(root,decodePlanSnapshot(new URLSearchParams(location.hash.slice(1)).get('plan')));}
    catch(error){root.replaceChildren();const heading=document.createElement('h1');heading.textContent='这份分享暂时打不开';const detail=document.createElement('p');detail.textContent=error.message;const back=document.createElement('a');back.textContent='返回纯过日子';back.href='/';root.append(heading,detail,back);}
  };
  renderCurrent();
  if(typeof window !== 'undefined') window.addEventListener('hashchange',renderCurrent);
}
