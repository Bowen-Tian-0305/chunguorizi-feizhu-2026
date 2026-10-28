import {createHmac} from 'node:crypto';
const unavailable = () => Object.assign(new Error('实时 AI 体验暂时关闭，仍可使用示例方案和手动填写。'), {status:503});
const positive = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value)>0 ? Number(value) : fallback;

// Store only pseudonymous counters in Supabase. Never fall back to memory.
export function createRemoteModelQuota(env=process.env, request=fetch) {
  async function reserve(address, now=Date.now()) {
    if (env.REALTIME_AI_ENABLED==='0') throw unavailable();
    try {
      const endpoint = new URL(env.SUPABASE_URL || '');
      if (endpoint.protocol!=='https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname!=='/') throw unavailable();
      const secret=env.SUPABASE_SERVICE_ROLE_KEY, hashSecret=env.QUOTA_HASH_SECRET;
      if (!secret || !hashSecret || hashSecret.length<32) throw unavailable();
      const day=Math.floor((now+8*3_600_000)/86_400_000);
      const digest=createHmac('sha256',hashSecret).update(`${day}:${address}`).digest('hex');
      const response=await request(new URL('/rest/v1/rpc/reserve_model_call',endpoint),{
        method:'POST', signal:AbortSignal.timeout(8000),
        headers:{'Content-Type':'application/json',apikey:secret,Authorization:`Bearer ${secret}`},
        body:JSON.stringify({p_client:digest,p_daily_limit:positive(env.MAX_MODEL_CALLS_PER_DAY,120),
          p_client_limit:positive(env.MODEL_CALLS_PER_IP_DAY,12),p_hourly_limit:positive(env.MODEL_CALLS_PER_IP_HOUR,12)})
      });
      if (!response.ok) throw unavailable();
      const result=await response.json();
      if (result?.allowed===false && result?.reason==='limit')
        throw Object.assign(new Error('今天的实时 AI 体验次数已用完。仍可查看不耗百炼额度的示例方案，明天再试。'),{status:429});
      if (result?.allowed!==true) throw unavailable();
    } catch(error) {
      if(error.status===429) throw error;
      throw unavailable();
    }
  }
  // The hosted backend currently exposes only a reservation RPC. A read must never reserve.
  reserve.status=async()=>({status:'unavailable',unit:'calls',remaining:null});
  return reserve;
}
