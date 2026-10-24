// Read-only call balance. Reading this endpoint never reserves a call.
export function createQuotaDisplay() {
  const root = document.createElement('details');
  root.className = 'quota-panel wrap';
  root.innerHTML = '<summary>可用调用次数 <span role="status" aria-live="polite">正在读取</span></summary><div class="quota-body"><div class="quota-grid"></div><p class="quota-accounting">次数按请求计，不按方案数计。语音转写与需求提取各占 1 次；截图提取、方案解读、单餐修改各占 1 次。预留后失败也计次。查询命中缓存不计次，读取余额不计次。</p><button type="button" class="text-button">刷新余额 ↻</button></div>';
  document.querySelector('main')?.before(root);
  const summary = root.querySelector('[role="status"]'), grid = root.querySelector('.quota-grid');
  let timer, pending = false, again = false;
  const validCounts = value => value && ['hour', 'day', 'siteDay'].every(key => Number.isInteger(value[key]) && value[key] >= 0);
  const resetText = value => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '待查询';
    return new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(value));
  };
  function render(data) {
    grid.replaceChildren(); const headlines = [];
    for (const [key, title] of [['modelCalls', 'AI 调用'], ['liveQueries', '酒店、周边与路线查询']]) {
      const value = data?.[key], available = value?.status === 'available' && validCounts(value.remaining) && validCounts(value.limits);
      const card = document.createElement('section');
      const heading = document.createElement('h3'); heading.textContent = title; card.append(heading);
      if (available) {
        headlines.push(`${key === 'modelCalls' ? 'AI' : '查询'}剩余 ${Math.min(...['hour', 'day', 'siteDay'].map(field => value.remaining[field]))} 次`);
        const list = document.createElement('dl');
        for (const [field, label] of [['hour', '你本小时'], ['day', '你今天'], ['siteDay', '全站今天']]) {
          const row = document.createElement('div'), term = document.createElement('dt'), amount = document.createElement('dd');
          term.textContent = label; amount.textContent = `余 ${value.remaining[field]} / ${value.limits[field]} 次`; row.append(term, amount); list.append(row);
        }
        card.append(list);
      } else {
        headlines.push(`${key === 'modelCalls' ? 'AI' : '查询'}余额待查询`);
        const notice = document.createElement('p'); notice.textContent = '余额暂不可用，请稍后刷新。'; card.append(notice);
      }
      const resets = value?.resetsAt || data?.resetsAt;
      const note = document.createElement('small'); note.textContent = `北京时间重置：小时 ${resetText(resets?.hour)}；每日 / 全站 ${resetText(resets?.day)}`; card.append(note); grid.append(card);
    }
    summary.textContent = headlines.join(' · ');
  }
  async function refresh() {
    if (pending) { again = true; return; }
    pending = true;
    try {
      const response = await fetch('/api/quota', {cache: 'no-store'});
      if (!response.ok) throw new Error();
      render(await response.json());
    } catch { render(null); }
    finally { pending = false; if (again) { again = false; scheduleRefresh(); } }
  }
  function scheduleRefresh() { clearTimeout(timer); timer = setTimeout(refresh, 150); }
  root.querySelector('button').addEventListener('click', scheduleRefresh);
  window.addEventListener('focus', scheduleRefresh);
  refresh();
  return {scheduleRefresh};
}
