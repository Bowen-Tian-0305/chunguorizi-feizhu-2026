import {readFileSync, writeFileSync, renameSync, mkdirSync, rmdirSync, existsSync} from 'node:fs';
import path from 'node:path';
import {createHmac, randomBytes} from 'node:crypto';

const unavailable = () => Object.assign(new Error('实时 AI 体验暂时关闭，仍可使用示例方案和手动填写。'), {status:503});
const exhausted = () => Object.assign(new Error('今天的实时 AI 体验次数已用完。仍可查看不耗百炼额度的示例方案，明天再试。'), {status:429});
const positive = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const validLedger = state => state && Number.isSafeInteger(state.day) && /^[a-f0-9]{64}$/.test(state.salt || '') &&
  Number.isSafeInteger(state.total) && state.total >= 0 && state.clients && typeof state.clients === 'object' && !Array.isArray(state.clients) &&
  Object.entries(state.clients).every(([id,client]) => /^[a-f0-9]{64}$/.test(id) && client &&
    [client.day,client.hour,client.count].every(n => Number.isSafeInteger(n) && n >= 0) && client.count <= client.day) &&
  Object.values(state.clients).reduce((total,client) => total + client.day,0) === state.total;

export function quotaResetTimes(now = Date.now()) {
  const beijing = time => new Date(time + 8 * 3_600_000).toISOString().replace('Z', '+08:00');
  return {hour:beijing((Math.floor(now / 3_600_000)+1)*3_600_000),day:beijing((Math.floor((now+8*3_600_000)/86_400_000)+1)*86_400_000-8*3_600_000)};
}

// A small single-instance demo ledger. Mount its directory on persistent storage.
// Never place the ledger under public/. A failed write prevents the model call.
export function createModelQuota(env = process.env) {
  const file = env.MODEL_QUOTA_FILE;
  let memory;
  const limits = () => ({hour:positive(env.MODEL_CALLS_PER_IP_HOUR,5),day:positive(env.MODEL_CALLS_PER_IP_DAY,5),siteDay:positive(env.MAX_MODEL_CALLS_PER_DAY,30)});
  function status(address, now = Date.now()) {
    const resetsAt=Number.isFinite(now)&&Math.abs(now)<8e15?quotaResetTimes(now):null, cap=limits();
    const unavailableStatus={status:'unavailable',unit:'calls',remaining:null,limits:cap,resetsAt};
    if(env.REALTIME_AI_ENABLED==='0'||(!file&&env.NODE_ENV==='production')||typeof address!=='string'||!address||!resetsAt)return unavailableStatus;
    try {
      if(file&&existsSync(`${file}.lock`))return unavailableStatus;
      let state=memory;
      if(file)state=JSON.parse(readFileSync(file,'utf8'));
      if(!validLedger(state))return unavailableStatus;
      const day=Math.floor((now+8*3_600_000)/86_400_000),hour=Math.floor(now/3_600_000);
      if(state.day!==day)return {status:'available',unit:'calls',remaining:{hour:cap.hour,day:cap.day,siteDay:cap.siteDay},limits:cap,resetsAt};
      const id=createHmac('sha256',state.salt).update(address).digest('hex');
      const client=state.clients[id]||{day:0,hour,count:0};
      if(![client.day,client.hour,client.count].every(n=>Number.isSafeInteger(n)&&n>=0))return unavailableStatus;
      return {status:'available',unit:'calls',remaining:{hour:Math.max(0,cap.hour-(client.hour===hour?client.count:0)),day:Math.max(0,cap.day-client.day),siteDay:Math.max(0,cap.siteDay-state.total)},limits:cap,resetsAt};
    } catch {return unavailableStatus;}
  }
  function reserve(address, now = Date.now()) {
    if (env.REALTIME_AI_ENABLED === '0' || (!file && env.NODE_ENV === 'production')) throw unavailable();
    const day = Math.floor((now + 8 * 3_600_000) / 86_400_000);
    const hour = Math.floor(now / 3_600_000);
    let locked = false;
    try {
      if (file) {
        mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
        mkdirSync(`${file}.lock`, {mode:0o700});
        locked = true;
      }
      let state = memory;
      if (file) {
        try { state = JSON.parse(readFileSync(file, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (state && !validLedger(state)) throw unavailable();
      if (!state || state.day !== day) state = {day, salt:randomBytes(32).toString('hex'), total:0, clients:{}};
      const id = createHmac('sha256', state.salt).update(address).digest('hex');
      const client = state.clients[id] || {day:0, hour, count:0};
      if (![client.day, client.hour, client.count].every(n => Number.isSafeInteger(n) && n >= 0)) throw unavailable();
      if (client.hour !== hour) {client.hour = hour; client.count = 0;}
      if (state.total >= positive(env.MAX_MODEL_CALLS_PER_DAY, 30) ||
          client.day >= positive(env.MODEL_CALLS_PER_IP_DAY, 5) ||
          client.count >= positive(env.MODEL_CALLS_PER_IP_HOUR, 5)) throw exhausted();
      state.total++; client.day++; client.count++; state.clients[id] = client;
      if (file) {
        const temporary = `${file}.tmp`;
        writeFileSync(temporary, JSON.stringify(state), {mode:0o600});
        renameSync(temporary, file);
      } else memory = state;
    } catch (error) {
      if (error.status === 429) throw error;
      throw unavailable();
    } finally {
      if (locked) {try {rmdirSync(`${file}.lock`);} catch { /* An operator must resolve a stale lock. */ }}
    }
  }
  reserve.status=status;
  return reserve;
}
