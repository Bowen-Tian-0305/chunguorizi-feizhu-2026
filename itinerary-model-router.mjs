const strictModels = new Set([
  'qwen4-max', 'qwen3.8-max-0902', 'deepseek-v4.1-flash-1017', 'deepseek-v4.1-flash'
]);
const supportedFallbacks = new Set([
  ...strictModels, 'qwen3.8-omni-flash', 'kimi-k3.1-pro'
]);

export const freeQuotaCode = 'BAILIAN_FREE_QUOTA_EXHAUSTED';
const freeQuotaError = () => Object.assign(
  new Error('旅行 AI 的免费额度已用完。仍可查看示例、手动算价差和选择餐馆。'),
  {status:429, code:freeQuotaCode}
);

export function itineraryRequest(model, messages, schema, maxTokens) {
  const isSnapshotBooking = model === 'qwen3.8-max-0902' && schema.json_schema.name === 'booking_extraction';
  const strict = strictModels.has(model) && !isSnapshotBooking;
  const responseFormat = strict ? schema : {type:'json_object'};
  const reasoning = model === 'qwen4-max' ? {reasoning_effort:'none'} : {enable_thinking:false};
  const routedMessages = strict ? messages : [
    {...messages[0], content:`${messages[0].content}\n按以下 JSON Schema 返回单一顶层 JSON 对象，不要返回数组或 Markdown：${JSON.stringify(schema.json_schema.schema)}`},
    ...messages.slice(1)
  ];
  return {
    model, messages:routedMessages, response_format:responseFormat,
    temperature:0, max_completion_tokens:maxTokens, ...reasoning,
    ...(model === 'qwen3.8-omni-flash' ? {modalities:['text']} : {})
  };
}

export function createItineraryRouter({primary, fallbackModels = [], request, now = Date.now, onExhausted = () => {}}) {
  const models = [...new Set([primary, ...fallbackModels.filter(model => supportedFallbacks.has(model))])];
  const unavailableUntil = new Map();
  const cooldown = 15 * 60 * 1000;
  return async function route({messages, schema, maxTokens, timeoutMs}) {
    const deadline = now() + timeoutMs;
    const attempted = new Set();
    for (let attempt = 0; attempt < 2; attempt++) {
      const time = now();
      const model = models.find(name => !attempted.has(name) && (unavailableUntil.get(name) ?? 0) <= time);
      if (!model || time >= deadline) throw freeQuotaError();
      attempted.add(model);
      try {
        return await request(itineraryRequest(model, messages, schema, maxTokens), deadline - time);
      } catch (error) {
        if (error?.code !== freeQuotaCode) throw error;
        unavailableUntil.set(model, now() + cooldown);
        onExhausted(model);
      }
    }
    throw freeQuotaError();
  };
}
