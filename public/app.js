import {compareBreakfast, breakfastDates} from './breakfast-decision.js';
const $ = id => document.getElementById(id);
const introSplash = $('introSplash');
try {
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      (new URLSearchParams(window.location.search).has('intro') || !sessionStorage.getItem('chunguorizi-intro-seen'))) {
    introSplash.hidden = false;
    sessionStorage.setItem('chunguorizi-intro-seen', '1');
    window.setTimeout(() => {introSplash.hidden = true;}, 1550);
  }
} catch {introSplash.hidden = true;}

const soundToggle = $('soundToggle');
let soundEnabled = true;
try {soundEnabled = localStorage.getItem('chunguorizi-sound') !== 'off';} catch {}
let soundContext;
function showSoundSetting() {
  soundToggle.setAttribute('aria-pressed', String(soundEnabled));
  soundToggle.setAttribute('aria-label', soundEnabled ? '关闭按键音效' : '开启按键音效');
  soundToggle.title = soundEnabled ? '关闭按键音效' : '开启按键音效';
  soundToggle.querySelector('span').textContent = soundEnabled ? '声音开' : '已静音';
}
function playUiSound(kind = 'tap') {
  if (!soundEnabled) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    soundContext ||= new AudioContextClass();
    if (soundContext.state === 'suspended') soundContext.resume().catch(() => {});
    const now = soundContext.currentTime;
    const notes = kind === 'confirm' ? [[392, 0], [587.33, .075]]
      : kind === 'success' ? [[440, 0], [554.37, .065], [659.25, .13]]
      : kind === 'toggle' ? [[523.25, 0]] : [[349.23, 0]];
    for (const [frequency, offset] of notes) {
      const tone = soundContext.createOscillator();
      const volume = soundContext.createGain();
      tone.type = 'sine'; tone.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, now + offset);
      volume.gain.exponentialRampToValueAtTime(kind === 'tap' ? .018 : .027, now + offset + .008);
      volume.gain.exponentialRampToValueAtTime(.0001, now + offset + .11);
      tone.connect(volume); volume.connect(soundContext.destination);
      tone.start(now + offset); tone.stop(now + offset + .12);
    }
  } catch { /* Audio is optional when a browser or device blocks it. */ }
}
showSoundSetting();
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button === soundToggle) {
    soundEnabled = !soundEnabled;
    try {localStorage.setItem('chunguorizi-sound', soundEnabled ? 'on' : 'off');} catch {}
    showSoundSetting();
    if (soundEnabled) playUiSound('toggle');
    return;
  }
  if (['recordTrip','recordRefine','cancelRecording'].includes(button.id)) return;
  if (button.id === 'makePlan' || button.id === 'understandTrip') playUiSound('success');
  else if (button.matches('.primary, .secondary')) playUiSound('confirm');
  else playUiSound('tap');
}, true);
const selectedBreakfastDates = new Set();
let breakfastDateSignature = '';
const state = {hotel: null, evidence: null, hotelPolicy: null, nearby: [], extracted: null, savedPlaces: [], demo: false, pane: "hotel", voiceCandidates: []};
let explainRevision = 0;
let nearbyRevision = 0;
const routeCache = new Map();
const mapState={view:{x:0,y:0,w:1000,h:640},selectedId:null,draft:{rating:0,note:''},reviews:{},status:''};
try{const saved=JSON.parse(localStorage.getItem('chunguorizi-place-notes-v1')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))mapState.reviews=saved;}catch{}
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = value => `¥${Number(value).toLocaleString('zh-CN')}`;
const safeUrl = value => {try{const url=new URL(String(value||''));return ['http:','https:'].includes(url.protocol)?url.href:'#';}catch{return '#';}};
const day = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
const today = new Date();
const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6);
const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
$('checkIn').value = day(start); $('checkOut').value = day(end);

async function api(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || '请求失败');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function notice(id, message, warn = false) {
  const el = $(id); el.textContent = message; el.classList.toggle('hidden', !message);
  el.classList.toggle('warn', warn);
}

api('/api/health').then(status => {
  $('serviceStatus').textContent = status.ok ? '可以开始安排了' : '服务连接中';
}).catch(() => {$('serviceStatus').textContent = '暂时连不上，请刷新再试';});

function cityName() {return $('city').value.replace(/市$|特别行政区$/, '');}
const cityPalettes={杭州:'jade',北京:'vermilion',上海:'ink',成都:'chili',重庆:'chili',西安:'ochre',三亚:'coast',厦门:'coast',青岛:'coast',深圳:'coast',广州:'citrus',南京:'jade',苏州:'jade'};
const cityEnglish={杭州:'HANGZHOU',北京:'BEIJING',上海:'SHANGHAI',成都:'CHENGDU',重庆:'CHONGQING',西安:'XI’AN',三亚:'SANYA',厦门:'XIAMEN',广州:'GUANGZHOU',深圳:'SHENZHEN'};
const cityCuisine={杭州:'杭帮菜',北京:'北京菜',上海:'本帮菜',成都:'川菜',重庆:'川菜',西安:'陕菜',三亚:'海南菜',厦门:'闽菜',青岛:'鲁菜',深圳:'粤菜',广州:'粤菜',南京:'淮扬菜',苏州:'苏帮菜'};
function applyCityVisual(){
  const name=cityName(),theme=cityPalettes[name]||'ink';
  document.body.dataset.city=name;document.body.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]').content={jade:'#183f35',ink:'#284962',vermilion:'#813e35',chili:'#8a4634',ochre:'#69553e',coast:'#176479',citrus:'#48604a'}[theme];
  $('cityPosterWord').textContent=name.slice(0,4);
  $('heroCityLabel').textContent=`${cityEnglish[name]||'CITY NOTES'} / ${name}旅居灵感`;
  $('heroCityCaption').textContent=name==='杭州'?'把早晨，留给喜欢的那一口。':`到${name}，把一日三餐过得有滋味。`;
  $('heroCityCredit').textContent=name==='杭州'?'杭州早餐氛围图 · 非真实门店与商品':'城市色彩海报 · 不代表真实门店或商品';
  $('discoverNav').classList.toggle('hidden',name!=='杭州');
  const cuisine=cityCuisine[name]||`${name}特色菜`;
  const localChip=document.querySelector('#nearbySection .chip[data-local-cuisine]')||document.querySelector('#nearbySection .chip[data-keyword="杭帮菜"]');
  const localMapFilter=document.querySelector('#nearbySection [data-map-local-cuisine]')||document.querySelector('#nearbySection [data-map-keyword="杭帮菜"]');
  if(localChip){localChip.dataset.keyword=cuisine;localChip.dataset.localCuisine='';}
  if(localMapFilter){localMapFilter.dataset.mapKeyword=cuisine;localMapFilter.dataset.mapLocalCuisine='';}
  const discoverLink=document.querySelector('.timeline-head + .timeline + .form-actions [data-pane="discover"]');
  if(discoverLink)discoverLink.classList.toggle('hidden',name!=='杭州');
}
function showPane(pane) {
  if (['preferences','result'].includes(pane) && !state.hotel) {
    notice('searchNotice','先选择一家酒店，或者上传截图再确认酒店位置。',true);pane='hotel';
  }
  if (pane === 'result' && $('planSection').classList.contains('hidden')) {
    pane='preferences';
  }
  state.pane=pane;
  document.body.dataset.pane=pane;
  for (const name of ['hotel','preferences','result','discover']) $(name+'Pane').classList.toggle('hidden',name!==pane);
  document.querySelectorAll('.journey-step').forEach(button => button.classList.toggle('active',button.dataset.pane===pane));
  window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelectorAll('[data-pane]').forEach(button => button.addEventListener('click',()=>showPane(button.dataset.pane)));
$('startTrip').addEventListener('click',()=>$('voiceWorkspace').scrollIntoView({behavior:'smooth'}));
$('manualEntryJump').addEventListener('click',()=>$('hotelWorkspace').scrollIntoView({behavior:'smooth'}));
$('continuePreferences').addEventListener('click',()=>showPane('preferences'));
function setEntry(mode) {
  document.querySelectorAll('[data-entry]').forEach(button=>button.classList.toggle('active',button.dataset.entry===mode));
  $('uploadEntry').classList.toggle('hidden',mode!=='upload');
}
document.querySelectorAll('[data-entry]').forEach(button=>button.addEventListener('click',()=>setEntry(button.dataset.entry)));
$('showExample').addEventListener('click',()=>$('examplePanel').classList.toggle('hidden'));
api('/api/cities').then(data => {
  const selected=$('city').value; $('city').innerHTML='';
  const hot=document.createElement('optgroup');hot.label='常用目的地';
  for(const city of ['杭州','北京','上海','成都','广州','深圳','西安','南京','厦门','三亚']) {
    const option=new Option(city,city);hot.append(option);
  }
  $('city').append(hot);
  for(const group of data.groups) {
    const optgroup=document.createElement('optgroup');optgroup.label=group.province;
    for(const name of group.cities) {const city=name.replace(/市$|特别行政区$/, '');optgroup.append(new Option(city,city));}
    $('city').append(optgroup);
  }
  $('city').value=selected;
  applyCityVisual();
}).catch(()=>notice('searchNotice','城市列表暂时没有加载成功，当前可先体验杭州。请稍后刷新重试。',true));
$('city').addEventListener('change',()=>{
  state.hotel=null;state.evidence=null;state.hotelPolicy=null;state.savedPlaces=[];state.nearby=[];state.voiceCandidates=[];state.demo=false;explainRevision++;nearbyRevision++;
  mapState.selectedId=null;mapState.draftId=null;resetMapView();expandNearbyMap(false);
  for(const id of ['selectedPanel','planSection','nearbySection']) $(id).classList.add('hidden');
  $('hotelResults').innerHTML='';$('manualResults').innerHTML='';
  $('cityBadge').textContent=cityName()==='杭州'?'杭州示范':cityName();
  $('cityScope').textContent=cityName()==='杭州'?'杭州可查看精选餐饮信息。其他城市可查酒店、算含早差价和找周边餐饮，深度餐饮资料正在扩充。':'已切换到'+cityName()+'。可查酒店、算早餐价差和找周边；杭州特色与酒店深度资料不会套到这里。台湾地区暂不支持高德路线。';
  applyCityVisual();
  notice('searchNotice','');
});
applyCityVisual();
function applyPreset(name) {
  $('adults').value=2;$('children').value=name==='family'?1:0;$('childAges').value=name==='family'?'6':'';
  $('mealPriority').value=name==='family'?'easy':'local';$('walkLimit').value=name==='family'?'10':'15';
  if(state.demo){$('roomOnly').value=1200;$('roomWith').value=1440;$('outsideBudget').value=35;$('breakfastCount').value=2;$('breakfastDays').value=name==='package'?1:2;$('comparable').checked=true;}
  $('mealRights').value=name==='package'?1:'';$('mealRightType').value=name==='package'?'dinner':'unknown';
  document.querySelector('.package-fields').open=name==='package';
  document.querySelectorAll('[data-preset]').forEach(button=>button.classList.toggle('active',button.dataset.preset===name));
}
document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>applyPreset(button.dataset.preset)));
async function tryDemo() {
  const button=$('tryDemo');button.disabled=true;button.textContent='准备杭州示例…';
  try {
    if($('city').value!=='杭州'){$('city').value='杭州';$('city').dispatchEvent(new Event('change'));}const data=await api('/api/demo');
    const checkIn=new Date();checkIn.setDate(checkIn.getDate()+6);const checkout=new Date(checkIn);checkout.setDate(checkout.getDate()+2);
    $('checkIn').value=day(checkIn);$('checkOut').value=day(checkout);$('query').value=data.hotel.name;
    state.demo=true;applyPreset('couple');notice('demoNotice',data.offline?'正在体验离线示例：房价 ¥1200 / ¥1440 为测试值，酒店位置为公开快照。实时语音、截图与地图服务需配置自己的密钥。':'正在体验示例：房价 ¥1200 / ¥1440 和套餐权益为测试值。酒店餐饮信息有真实出处，周边路线按当前地图查询。');
    await selectHotel(data.hotel);$('makePlan').click();
  } catch(error) {notice('searchNotice','示例暂时无法加载：'+error.message,true);showPane('hotel');}
  finally {button.disabled=false;button.textContent='先试试杭州示例 ↗';}
}
$('tryDemo').addEventListener('click',tryDemo);$('demoStripButton').addEventListener('click',tryDemo);

const voiceExamples = {
  family:'下周六去杭州住两晚，两大一小，想住杭州城中香格里拉大酒店。孩子六岁，不吃花生，想吃杭州特色早餐，最多走十分钟。',
  early:'下周去杭州住两晚，两个人住杭州城中香格里拉大酒店，早上七点出门赶车，只打算用一次酒店早餐，含早全程比不含早贵240元。',
  local:'去杭州西湖边住两晚，两个人想吃本地早点和杭帮菜，早餐人均预算35元，最多走15分钟。先帮我找合适的酒店候选。'
};
document.querySelectorAll('[data-voice-sample]').forEach(button=>button.addEventListener('click',()=>{
  $('tripVoiceText').value=voiceExamples[button.dataset.voiceSample]||'';
  $('tripVoiceText').focus();$('voiceWorkspace').scrollIntoView({behavior:'smooth'});
}));

function setField(id,value){if(value!==undefined&&value!==null&&value!=='')$(id).value=value;}
function applyVoiceFields(fields){
  if(fields.city){
    const city=String(fields.city).replace(/市$|特别行政区$/,'');
    if([...$('city').options].some(option=>option.value===city)&&$('city').value!==city){$('city').value=city;$('city').dispatchEvent(new Event('change'));}
  }
  if(fields.check_in)setField('checkIn',fields.check_in);
  if(fields.check_out)setField('checkOut',fields.check_out);
  else if(fields.check_in&&fields.nights){const d=new Date(`${fields.check_in}T12:00:00`);d.setDate(d.getDate()+fields.nights);setField('checkOut',day(d));}
  else if(fields.nights){const d=new Date(`${$('checkIn').value}T12:00:00`);d.setDate(d.getDate()+fields.nights);setField('checkOut',day(d));}
  for(const [field,id] of Object.entries({adults:'adults',children:'children',child_ages:'childAges',dietary:'dietary',meal_priority:'mealPriority',walk_limit_minutes:'walkLimit',outside_breakfast_budget:'outsideBudget',room_only_total:'roomOnly',breakfast_room_total:'roomWith',breakfast_count_per_night:'breakfastCount',breakfast_use_days:'breakfastDays',morning_departure:'morningDeparture',meal_rights:'mealRights',meal_right_type:'mealRightType'}))setField(id,fields[field]);
  if(fields.meal_rights)document.querySelector('.package-fields').open=true;
  if(fields.same_room_terms===true)$('comparable').checked=true;
  if(fields.hotel_name)setField('query',fields.hotel_name);
}
function voiceSummary(data){
  const f=data.fields,items=[];
  if(f.city)items.push(f.city);
  if(f.hotel_name)items.push(f.hotel_name);
  else if(f.lodging_area)items.push(f.lodging_area+'附近');
  if(f.check_in)items.push(`${f.check_in} 入住`);
  if(f.nights)items.push(`${f.nights} 晚`);
  if(f.adults)items.push(`${f.adults} 位成人`);
  if(f.children)items.push(`${f.children} 位儿童`);
  if(f.dietary)items.push(`忌口：${f.dietary}`);
  if(f.walk_limit_minutes)items.push(`步行 ≤ ${f.walk_limit_minutes} 分钟`);
  if(f.breakfast_use_days!==undefined)items.push(`酒店早餐用 ${f.breakfast_use_days} 天`);
  if(f.room_only_total!==undefined&&f.breakfast_room_total!==undefined)items.push(`两档总价 ${money(f.room_only_total)} / ${money(f.breakfast_room_total)}`);
  const box=$('voiceUnderstanding');
  box.innerHTML=`<strong>我听到的是</strong><p>${escapeHtml(data.summary||'已提取你说出的旅行需求。')}</p><div>${items.map(item=>`<span>${escapeHtml(item)}</span>`).join('')}</div><small>识别有误，可以修改文字后再点“帮我安排”。${data.questions?.length?' 还想确认：'+escapeHtml(data.questions.join('；')):''}</small>`;
  box.classList.remove('hidden');
}
function normalizeHotelName(name){return String(name||'').replace(/[·\s（）()酒店大饭店]/g,'').toLowerCase();}
async function selectVoiceHotel(item){
  $('voiceCandidates').innerHTML='';notice('voiceStatus',`已选「${item.name}」，正在整理早餐、餐券与附近吃饭选择…`);
  await selectHotel(item);$('makePlan').click();
}
async function findVoiceHotels(fields){
  const q=fields.hotel_name||fields.lodging_area;
  if(!q){
    if(state.hotel){$('makePlan').click();return;}
    notice('voiceStatus','需求已经记下。再说出酒店名称，或在下方选一家酒店，我就能结合位置出方案。');
    $('hotelWorkspace').scrollIntoView({behavior:'smooth'});return;
  }
  if(!fields.hotel_name&&state.hotel){$('makePlan').click();return;}
  notice('voiceStatus',`正在查${fields.hotel_name?'酒店':'区域'}候选，请核对名称和地址…`);
  const params=new URLSearchParams({q,city:cityName(),checkIn:$('checkIn').value,checkOut:$('checkOut').value});
  const result=await api(`/api/hotels?${params}`);
  state.voiceCandidates=result.items||[];
  const target=normalizeHotelName(fields.hotel_name);
  const exact=fields.hotel_name?result.items.filter(item=>normalizeHotelName(item.name)===target):[];
  if(exact.length===1){await selectVoiceHotel(exact[0]);return;}
  const box=$('voiceCandidates');box.innerHTML='';
  for(const [index,item] of result.items.slice(0,8).entries()){
    const button=document.createElement('button');button.type='button';button.className='hotel-card voice-hotel';
    button.innerHTML=`<div class="hotel-body"><span class="hotel-tag">候选 ${index+1}</span><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.address||'地址待核对')}</p><span class="voice-hotel-action">选这家，生成方案 ↗</span></div>`;
    button.addEventListener('click',()=>selectVoiceHotel(item).catch(error=>notice('voiceStatus',error.message,true)));
    box.append(button);
  }
  notice('voiceStatus',result.items.length?`找到 ${result.items.length} 家飞猪候选。请点选你要住的那家，或再说“选第几家”。`:'这次没有找到明确酒店。可以缩短名称重试，或在下方手动核对地址。',!result.items.length);
}
let voiceBusy=false;
async function planFromVoice(text,refining=false){
  text=String(text||'').trim();const statusId=refining?'refineStatus':'voiceStatus';
  if(text.length<4){notice(statusId,'请先说说住哪里、谁同行，以及你想怎么吃。',true);return;}
  if(voiceBusy)return;voiceBusy=true;$('understandTrip').disabled=true;$('refinePlan').disabled=true;
  notice(statusId,'正在理解你的需求…');
  try{
    const data=await api('/api/understand',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
    if(state.demo){
      state.demo=false;state.hotel=null;state.evidence=null;state.hotelPolicy=null;state.savedPlaces=[];state.nearby=[];
      mapState.selectedId=null;mapState.draftId=null;resetMapView();expandNearbyMap(false);
      for(const id of ['roomOnly','roomWith','outsideBudget','breakfastCount','breakfastDays','mealRights'])$(id).value='';
      $('comparable').checked=false;$('mealRightType').value='unknown';$('selectedPanel').classList.add('hidden');
      $('planSection').classList.add('hidden');$('nearbySection').classList.add('hidden');notice('demoNotice','');
    }
    applyVoiceFields(data.fields);voiceSummary(data);
    const chosen=Number(data.fields.hotel_selection_index);
    if(chosen&&state.voiceCandidates[chosen-1])await selectVoiceHotel(state.voiceCandidates[chosen-1]);
    else if(refining&&state.hotel&&!data.fields.hotel_name){$('makePlan').click();notice('refineStatus','已按你刚说的重新安排。');}
    else await findVoiceHotels(data.fields);
  }catch(error){notice(statusId,'这次没安排好：'+error.message,true);}
  finally{voiceBusy=false;$('understandTrip').disabled=false;$('refinePlan').disabled=false;}
}
$('understandTrip').addEventListener('click',()=>planFromVoice($('tripVoiceText').value));
$('refinePlan').addEventListener('click',()=>planFromVoice($('refineText').value,true));
$('refineText').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('refinePlan').click();}});

let recorder=null,recordChunks=[],recordStream=null,recordTimer=null,recordTarget='trip';
function resetRecorder(){
  if(recordTimer)clearTimeout(recordTimer);recordTimer=null;
  if(recordStream)recordStream.getTracks().forEach(track=>track.stop());recordStream=null;
  recorder=null;recordChunks=[];$('cancelRecording').classList.add('hidden');
  for(const id of ['recordTrip','recordRefine']){$(id).classList.remove('recording');$(id).disabled=false;}
  $('recordTrip').querySelector('span').textContent='点一下，说说旅行';
}
async function toWavDataUrl(blob){
  const buffer=await blob.arrayBuffer();const context=new AudioContext();
  let decoded;try{decoded=await context.decodeAudioData(buffer);}finally{await context.close();}
  if(decoded.duration>90)throw new Error('录音请控制在90秒以内');
  const frameCount=Math.ceil(decoded.duration*16000);
  const offline=new OfflineAudioContext(1,frameCount,16000);const source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
  const rendered=await offline.startRendering();const samples=rendered.getChannelData(0);const wav=new ArrayBuffer(44+samples.length*2);const view=new DataView(wav);
  const str=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  str(0,'RIFF');view.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,samples.length*2,true);
  samples.forEach((sample,index)=>view.setInt16(44+index*2,Math.round(Math.max(-1,Math.min(1,sample))*(sample<0?32768:32767)),true));
  const bytes=new Uint8Array(wav);let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return 'data:audio/wav;base64,'+btoa(binary);
}
async function submitAudio(blob,target){
  const statusId=target==='refine'?'refineStatus':'voiceStatus';notice(statusId,'正在转写你说的话…');
  const audio=await toWavDataUrl(blob);if(audio.length>6_000_000)throw new Error('录音太大，请缩短到90秒以内');
  const result=await api('/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audio})});
  const input=target==='refine'?'refineText':'tripVoiceText';$(input).value=result.transcript;
  await planFromVoice(result.transcript,target==='refine');
}
async function toggleRecord(target){
  const statusId=target==='refine'?'refineStatus':'voiceStatus';
  if(recorder?.state==='recording'){recorder.stop();return;}
  try{
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('当前浏览器不支持录音，请上传语音文件或输入文字');
    recordStream=await navigator.mediaDevices.getUserMedia({audio:true});recordTarget=target;
    recorder=new MediaRecorder(recordStream);recordChunks=[];
    recorder.ondataavailable=event=>{if(event.data.size)recordChunks.push(event.data);};
    recorder.onstop=async()=>{const blob=new Blob(recordChunks,{type:recorder.mimeType});resetRecorder();try{await submitAudio(blob,target);}catch(error){notice(statusId,'语音处理失败：'+error.message,true);}};
    recorder.start();$(target==='refine'?'recordRefine':'recordTrip').classList.add('recording');
    $('recordTrip').querySelector('span').textContent='结束录音，生成方案';$('cancelRecording').classList.remove('hidden');
    notice(statusId,'正在录音，再点一次结束。最长90秒。');recordTimer=setTimeout(()=>{if(recorder?.state==='recording')recorder.stop();},90_000);
  }catch(error){resetRecorder();notice(statusId,'无法开始录音：'+error.message,true);}
}
$('recordTrip').addEventListener('click',()=>toggleRecord('trip'));
$('recordRefine').addEventListener('click',()=>toggleRecord('refine'));
$('cancelRecording').addEventListener('click',()=>{if(recorder?.state==='recording'){recorder.onstop=resetRecorder;recorder.stop();}else resetRecorder();notice('voiceStatus','已取消本次录音。');});
$('audioFile').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{await submitAudio(file,'trip');}catch(error){notice('voiceStatus','语音文件处理失败：'+error.message,true);}event.target.value='';});

let cityFoodData = {guide: [], venues: [], rankings: {ranked:[]}};
let cityFoodMode = 'breakfast';
let cityFoodLimit = 18;
const mealLabels = {breakfast:'早餐', lunch:'午餐', dinner:'晚餐', brunch:'早午餐'};

function citySource(sources) {
  const source=sources?.[0];if(!source)return '';
  const date=source.published_at?` · ${escapeHtml(source.published_at.slice(0,10))}`:'';
  return `<details class="source-detail"><summary>信息说明</summary><a href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(/携程|ctrip|trip\.com/i.test(source.title || '') ? '网络公开资料原文' : source.title || '资料原文')}${date} ↗</a></details>`;
}

function renderCityFood() {
  $('cityFoodSearchWrap').classList.toggle('hidden', !['venues','rankings'].includes(cityFoodMode));
  $('rankingFilters').classList.toggle('hidden',cityFoodMode!=='rankings');
  $('cityFoodSearch').placeholder=cityFoodMode==='rankings'?'搜门店、区县或菜品，例如：上城、煎饺':'按门店、道路或餐次查找，例如：马塍路、奎元馆、晚餐';
  $('cityFoodMore').classList.add('hidden');
  const results = $('cityFoodResults'); results.innerHTML = '';
  if(cityFoodMode==='rankings'){
    const query=$('cityFoodSearch').value.trim().toLowerCase();
    const category=$('rankingCategory').value,district=$('rankingDistrict').value;
    const records=cityFoodData.cityDining?.venues || cityFoodData.rankings.ranked;
    const items=records.filter(item=>(!category||(category==='早餐线索'?item.facts.some(f=>f.field==='breakfast_served'):item.memberships.some(m=>m.category===category)))&&(!district||item.district===district)&&(!query||[item.name,item.district,item.address,...item.memberships.map(m=>m.platform_tags),...item.facts.map(f=>f.value)].join(' ').toLowerCase().includes(query)));
    $('cityFoodShown').textContent=`找到 ${items.length} 家门店资料`;
    const snapshot=cityFoodData.cityDining;
    notice('cityFoodNotice',snapshot?`已整理 ${snapshot.venue_count} 家去重门店，其中 ${snapshot.address_confirmed_count} 家核到地址、${snapshot.breakfast_evidence_count} 家有历史早餐证据。资料仅用于发现候选；当天营业、菜单、价格和忌口请向门店确认。`:'餐馆资料加载中；门店实际营业请再次确认。');
    for(const item of items.slice(0,cityFoodLimit)){
      const card=document.createElement('article');card.className='city-food-card ranking-card';
      const categories=[...new Set(item.memberships.map(m=>m.category))];
      const breakfast=item.facts.find(f=>f.field==='breakfast_served');
      const source=item.memberships[0]?.source_url || item.sources?.[0]?.url;
      card.innerHTML=`<span class="city-food-type">${escapeHtml(categories.join(' · ')||'杭州门店资料')}</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.district)} · ${escapeHtml(item.address||'门牌地址待核，暂不能计算步行时间')}</p><div class="ranking-facts">${breakfast?`<span>历史早餐线索，当前供应待核 ${breakfast.source_url?`<a href="${safeUrl(breakfast.source_url)}" target="_blank" rel="noopener noreferrer">查看 ↗</a>`:''}</span>`:''}${item.has_conflict?'<span>门店或地址资料有歧义，请核对</span>':''}</div><div class="city-food-card-foot"><small>公开资料 · ${escapeHtml(cityFoodData.cityDining?.captured_at||'2026-10-11')}</small>${source?`<a href="${safeUrl(source)}" target="_blank" rel="noopener noreferrer">查看原始资料 ↗</a>`:''}${item.address_status==='address_confirmed'?'<button type="button">查我住处附近有没有 ↗</button>':''}</div>`;
      const button=card.querySelector('button');if(button)button.addEventListener('click',()=>{
        if(!state.hotel){notice('cityFoodNotice','先选一家酒店，再查你住处附近有没有这家店。',true);return;}
        if($('planSection').classList.contains('hidden'))$('makePlan').click();else showPane('result');
        loadNearby(item.name);$('nearbySection').scrollIntoView({behavior:'smooth',block:'start'});
      });
      results.append(card);
    }
    $('cityFoodMore').classList.toggle('hidden',items.length<=cityFoodLimit);
    return;
  }
  if (cityFoodMode !== 'venues') {
    const type = cityFoodMode === 'breakfast' ? 'breakfast' : 'lunch';
    const items = cityFoodData.guide.filter(item => item.guide_id !== 'G013' &&
      (item.meal_type.includes(type) || (type === 'lunch' && item.meal_type.includes('dinner'))));
    const spots=cityFoodMode==='breakfast'?(cityFoodData.breakfast_spots?.spots||[]):[];
    for(const item of spots){
      const card=document.createElement('article');card.className='city-food-card breakfast-spot-card';
      card.innerHTML=`<span class="city-food-type">可以去找的杭州早饭</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.district)} · ${escapeHtml(item.address)}</p><div class="city-food-note">${escapeHtml(item.foods)}</div><small>${escapeHtml(item.dietary_signal)}；地图查同名店时请核对分店地址。</small><div class="city-food-card-foot"><details class="source-detail"><summary>店铺资料</summary><a href="${safeUrl(item.source_url)}" target="_blank" rel="noopener noreferrer">查看米其林指南 ↗</a></details><button type="button">查附近同名店 ↗</button></div>`;
      card.querySelector('button').addEventListener('click',()=>{
        if(!state.hotel){notice('cityFoodNotice','先选一家酒店，再查这家店离住处有多远。',true);return;}
        if($('planSection').classList.contains('hidden'))$('makePlan').click();else showPane('result');
        loadNearby(item.name.replace(/（.*?）/g,''));$('nearbySection').scrollIntoView({behavior:'smooth',block:'start'});
      });
      results.append(card);
    }
    for (const item of items) {
      const card = document.createElement('article'); card.className = 'city-food-card';
      card.innerHTML = `<span class="city-food-type">${cityFoodMode === 'breakfast' ? '早饭灵感' : '杭州正餐'}</span><h3>${escapeHtml(item.food_name)}</h3><p>${escapeHtml(item.local_relevance)}</p><div class="city-food-card-foot"><small>饮食文化线索，门店供应待查</small>${citySource(item.sources)}</div>`;
      results.append(card);
    }
    $('cityFoodShown').textContent=spots.length?`${spots.length} 家有地址的早餐门店 · ${items.length} 条当地吃法`:`${items.length} 条当地吃法`;
    notice('cityFoodNotice',spots.length?'门店菜品来自公开指南，位置与步行路线可继续查；当天营业、实际价格和忌口请向门店确认。':items.length?'':'这一餐次尚无可展示的特色资料。');
    return;
  }
  const query = $('cityFoodSearch').value.trim().toLowerCase();
  const items = cityFoodData.venues.filter(item => !query ||
    [item.name, item.address, ...item.services.map(s => (mealLabels[s.meal_type] || s.meal_type) + s.notable_dishes)]
      .join(' ').toLowerCase().includes(query));
  items.sort((a, b) => {
    const rank = item => item.services.some(s => s.meal_type === 'breakfast' && s.start_time) ? 0
      : item.services.some(s => s.meal_type === 'breakfast') ? 1 : 2;
    return rank(a) - rank(b) || a.venue_id.localeCompare(b.venue_id);
  });
  $('cityFoodShown').textContent = `找到 ${items.length} 家门店`;
  notice('cityFoodNotice', items.length ? '' : '资料库里没有匹配的门店；可以用酒店周边高德查询继续找。');
  for (const item of items.slice(0, cityFoodLimit)) {
    const breakfast = item.services.find(s => s.meal_type === 'breakfast');
    const meals = [...new Set(item.services.map(s => mealLabels[s.meal_type] || s.meal_type))].join(' · ');
    const note = item.venue_id === 'CV060' ? '2020 年历史线索；当前营业与菜单未核'
      : breakfast?.start_time
      ? `2025 年资料：${breakfast.start_time} 起有早餐线索；当天营业待核`
      : breakfast ? '早餐品类有资料；时段待核' : meals || '仅核到门店存在；餐次待核';
    const card = document.createElement('article'); card.className = 'city-food-card venue-food-card';
    card.innerHTML = `<span class="city-food-type">${breakfast ? '早餐门店线索' : '餐饮门店线索'}</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.address)}</p><div class="city-food-note">${escapeHtml(note)}</div><div class="city-food-card-foot">${citySource(breakfast?.start_time ? breakfast.sources : item.sources)}<button type="button">查所选酒店附近 ↗</button></div>`;
    card.querySelector('button').addEventListener('click', () => {
      if (!state.hotel) {notice('cityFoodNotice', '先在上方选一家酒店，才能判断这家门店是否在步行范围内。', true); return;}
      $('nearbySection').classList.remove('hidden');
      document.querySelectorAll('.chip').forEach(chip => {if (chip.dataset.keyword !== undefined) chip.classList.remove('active');});
      if ($('planSection').classList.contains('hidden')) $('makePlan').click();
      else showPane('result');
      loadNearby(item.name);
      $('nearbySection').scrollIntoView({behavior:'smooth', block:'start'});
    });
    results.append(card);
  }
  $('cityFoodMore').classList.toggle('hidden', items.length <= cityFoodLimit);
}

document.querySelectorAll('#cityFoodModes .chip').forEach(chip => chip.addEventListener('click', () => {
  cityFoodMode = chip.dataset.mode;
  document.querySelectorAll('#cityFoodModes .chip').forEach(x => x.classList.toggle('active', x === chip));
  renderCityFood();
}));
$('cityFoodSearch').addEventListener('input', () => {cityFoodLimit = 18; renderCityFood();});
$('rankingCategory').addEventListener('change',()=>{cityFoodLimit=18;renderCityFood();});
$('rankingDistrict').addEventListener('change',()=>{cityFoodLimit=18;renderCityFood();});
$('cityFoodMore').addEventListener('click', () => {cityFoodLimit += 18; renderCityFood();});
Promise.all([api('/api/city-food'),fetch('/city-dining.json').then(response=>response.ok?response.json():null).catch(()=>null)]).then(([data,snapshot]) => {
  cityFoodData = data;
  if(snapshot)cityFoodData.cityDining=snapshot;
  $('cityFoodCount').textContent = `${data.guide.length - 1} 条杭州饮食线索 · ${data.venues.length} 家餐饮专题门店 · ${snapshot?.venue_count||data.rankings.venue_count} 家公开资料门店（各库可能重叠）`;
  const districts=[...new Set((snapshot?.venues||data.rankings.ranked).map(item=>item.district))].filter(name=>name!=='区县待核').sort((a,b)=>a.localeCompare(b,'zh-CN'));
  for(const district of districts)$('rankingDistrict').append(new Option(district,district));
  $('rankingDistrict').append(new Option('区县待核','区县待核'));
  renderCityFood();
}).catch(error => notice('cityFoodNotice', `餐饮资料暂不可用：${error.message}`, true));

$('searchForm').addEventListener('submit', async event => {
  event.preventDefault();
  state.hotel = null; state.evidence = null; state.hotelPolicy=null; state.nearby = []; state.savedPlaces=[]; state.demo=false;notice('demoNotice','');explainRevision++;nearbyRevision++;
  $('selectedPanel').classList.add('hidden'); $('planSection').classList.add('hidden'); $('nearbySection').classList.add('hidden');
  const q = $('query').value.trim();
  if (!q) return;
  notice('searchNotice', '正在向飞猪查询酒店…'); $('hotelResults').innerHTML = '';
  try {
    const params = new URLSearchParams({q, city: cityName(), checkIn: $('checkIn').value, checkOut: $('checkOut').value});
    const result = await api(`/api/hotels?${params}`);
    notice('searchNotice', result.limited_mode
      ? `找到 ${result.items.length} 家候选酒店，先核对名称和地址。准确房型价格请打开预订页或上传截图。`
      : `这次查询返回 ${result.items.length} 条候选；请按名称和地址确认酒店。`, result.limited_mode);
    if (!result.items.length) $('hotelResults').innerHTML = '<div class="notice">没有查到候选。可缩短名称，或手动输入酒店地址再试。</div>';
    result.items.forEach(item => {
      const card = document.createElement('button'); card.className = 'hotel-card'; card.type = 'button';
      card.innerHTML = `<div class="hotel-photo" ${item.image ? `style="background-image:url('${escapeHtml(item.image)}')"` : ''}></div><div class="hotel-body"><div class="hotel-tags"><span class="hotel-tag">飞猪候选</span><span class="hotel-tag muted">${item.reviewed_id ? '有酒店餐饮信息' : '可找周边餐馆'}</span></div><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.address || '地址未提供')}</p><div class="hotel-card-footer"><span>${escapeHtml(item.star || '酒店')}</span><b>${escapeHtml(item.price_band || '查价格')}</b></div></div>`;
      card.addEventListener('click', () => selectHotel(item)); $('hotelResults').append(card);
    });
  } catch (error) { notice('searchNotice', error.message, true); }
});

async function selectHotel(item) {
  selectedBreakfastDates.clear();breakfastDateSignature='';
  state.hotel = item; state.evidence = null; state.hotelPolicy=null; state.nearby = [];state.savedPlaces=[];mealSelections.clear();explainRevision++;nearbyRevision++;
  mapState.selectedId=null;mapState.draftId=null;resetMapView();expandNearbyMap(false);
  $('selectedName').textContent = item.name; $('selectedAddress').textContent = item.address || '飞猪未提供地址';
  $('bookingLink').href = safeUrl(item.booking_url);
  $('bookingLink').classList.toggle('hidden', !item.booking_url);
  $('priceNotice').textContent = item.manual ? '手动定位不含飞猪房价；请从当前商品截图或订单页填写两档价格' : '飞猪列表价如“¥5xx”只是档位，不能当结算价';
  $('evidenceBadge').textContent = item.demo ? '示例房价 · 真实酒店资料' : item.reviewed_id ? '有酒店餐饮信息' : '可查周边餐馆';
  $('evidenceBadge').classList.toggle('basic', !item.reviewed_id);
  $('selectedWarnings').textContent = item.manual
    ? `你输入「${item.manual_input}」；高德返回「${item.address}」（精度：${item.location_level}）。道路名称也可能不同，请核对酒店名称、区县和门牌；餐饮资料按基础版呈现。`
    : item.address_conflict ? `注意：飞猪列表地址与酒店官网不一致；官网为「${item.official_address}」。请以实际预订页和酒店确认。` : '';
  $('selectedPanel').classList.remove('hidden');
  if (item.reviewed_id) {
    try { state.evidence = await api(`/api/evidence/${encodeURIComponent(item.reviewed_id)}`); }
    catch (error) { $('selectedWarnings').textContent += ` 餐饮证据读取失败：${error.message}`; }
  }
  try{state.hotelPolicy=(await api(`/api/hotel-policy?${new URLSearchParams({name:item.name})}`)).policy;}
  catch{state.hotelPolicy=null;}
  $('nearbySection').classList.remove('hidden');
  $('tripSummary').textContent=`${item.name} · ${nights()} 晚，按你们的习惯来安排。`;
  document.querySelectorAll('#nearbySection .chip').forEach(chip=>chip.classList.toggle('active',chip.dataset.keyword==='早餐'));
  document.querySelectorAll('[data-map-keyword]').forEach(button=>button.classList.toggle('active',button.dataset.mapKeyword==='早餐'));
  showPane('preferences');loadNearby('早餐');
}

$('locateHotel').addEventListener('click', async () => {
  const name = $('query').value.trim(), address = $('manualAddress').value.trim();
  if (!name || !address) {notice('manualNotice', '先填酒店名称和预订页上的完整地址。', true); return;}
  notice('manualNotice', '正在用高德核对地址…'); $('manualResults').innerHTML = '';
  try {
    const data = await api(`/api/geocode?${new URLSearchParams({address,city:cityName()})}`);
    if (!data.items.length) {notice('manualNotice', '高德没有找到明确的酒店地址，请核对区县、道路和门牌。', true); return;}
    notice('manualNotice', '以下是高德定位候选，选中前请核对地址；街道级结果可能不够准确。');
    data.items.forEach((location, index) => {
      const [longitude, latitude] = location.location.split(',').map(Number);
      const item = {id:`manual-${index}`,name,address:location.address,longitude,latitude,
        price_band:'',star:'手动定位',image:'',booking_url:'',reviewed_id:null,
        manual:true,manual_input:address,location_level:location.level};
      const button = document.createElement('button'); button.type = 'button'; button.className = 'hotel-card manual-card';
      button.innerHTML = `<div class="hotel-body"><div class="hotel-tags"><span class="hotel-tag muted">高德地址定位</span></div><strong>${escapeHtml(name)}</strong><p>${escapeHtml(location.address)}</p><div class="hotel-card-footer"><span>精度：${escapeHtml(location.level)}</span><b>选择位置 ↗</b></div></div>`;
      button.addEventListener('click', () => selectHotel(item)); $('manualResults').append(button);
    });
  } catch (error) {notice('manualNotice', `地址定位未完成：${error.message}`, true);}
});

function setNearbyKeyword(keyword){
  document.querySelectorAll('#nearbySection .chip').forEach(button=>button.classList.toggle('active',button.dataset.keyword===keyword));
  document.querySelectorAll('[data-map-keyword]').forEach(button=>button.classList.toggle('active',button.dataset.mapKeyword===keyword));
  loadNearby(keyword);
}
document.querySelectorAll('#nearbySection .chip').forEach(chip=>chip.addEventListener('click',()=>setNearbyKeyword(chip.dataset.keyword||'')));
document.querySelectorAll('[data-map-keyword]').forEach(button=>button.addEventListener('click',()=>setNearbyKeyword(button.dataset.mapKeyword||'')));

async function placeRoute(place, revision) {
  const origin=`${Number(state.hotel.longitude).toFixed(6)},${Number(state.hotel.latitude).toFixed(6)}`;
  const key=origin+'>'+place.location;
  let result=routeCache.get(key);
  if(!result){result=await api(`/api/route?${new URLSearchParams({origin,destination:place.location})}`);routeCache.set(key,result);}
  if(revision!==nearbyRevision)return null;
  place.route=result;return result;
}
function breakfastSignal(place){
  if(place.curated_match?.meal_types?.includes('breakfast'))return 3;
  if(/片儿川|小笼|煎饺|煎包|烧饼|油条|饭团|豆腐包|馄饨|粥|面店|面馆|早餐|早点|米线/.test(place.name))return 2;
  if(/星巴克|麦当劳|肯德基|咖啡|汉堡|牛排|奶茶/.test(place.name))return -1;
  return 0;
}
const SVG_NS='http://www.w3.org/2000/svg';
function svgEl(tag,attributes={}){const node=document.createElementNS(SVG_NS,tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));return node;}
function mapView(){const {x,y,w,h}=mapState.view;$('nearbyMap').setAttribute('viewBox',`${x} ${y} ${w} ${h}`);}
function resetMapView(){mapState.view={x:0,y:0,w:1000,h:640};mapView();}
function zoomMap(factor){
  const old=mapState.view,w=Math.max(300,Math.min(1800,old.w*factor)),h=w*.64;
  mapState.view={x:old.x+(old.w-w)/2,y:old.y+(old.h-h)/2,w,h};mapView();
}
function chooseMapPlace(id){
  if(!state.nearby.some(place=>place.id===id))return;
  mapState.selectedId=id;mapState.draftId=null;mapState.status='';renderNearby();
}
function reviewFor(place){const item=mapState.reviews[place.id];return item&&typeof item==='object'?item:{rating:0,note:''};}
function openingSummary(value){
  const raw=String(value||'').trim();
  const spans=raw.match(/\d{1,2}:\d{2}-\d{1,2}:\d{2}/g)||[];
  if(spans.length&&raw.replace(/\d{1,2}:\d{2}-\d{1,2}:\d{2}|[\s,，;；、]/g,'')==='')return [...new Set(spans)].join('、');
  return raw;
}
function renderMapDetail(place){
  const target=$('mapPlaceDetail');if(!place){target.innerHTML='<p>选一家店，看看步行时间和你的用餐笔记。</p>';return;}
  if(mapState.draftId!==place.id){const old=reviewFor(place);mapState.draft={rating:Number(old.rating)||0,note:String(old.note||'')};mapState.draftId=place.id;mapState.status='';}
  const saved=state.savedPlaces.some(item=>item.id===place.id);
  const route=place.route?`步行 ${place.route.minutes} 分钟 · ${place.route.meters} 米`:'步行路线尚未查到';
  const meta=[place.rating?`高德评分 ${escapeHtml(place.rating)}`:'',place.cost?`参考人均 ${money(place.cost)}`:'',place.opening_today?`今日参考营业 ${escapeHtml(openingSummary(place.opening_today))}`:''].filter(Boolean).join(' · ');
  target.innerHTML=`<div class="map-detail-head">${place.photo?`<img src="${safeUrl(place.photo)}" alt="${escapeHtml(place.name)}地点配图" loading="lazy">`:''}<div><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(place.address||'地址以地图为准')}</small></div></div><p class="map-detail-meta">${escapeHtml(route)}${meta?`<br>${meta}`:''}</p><div class="map-detail-actions"><button type="button" class="map-add">${saved?'已加入方案 ✓':'加入我的方案 +'}</button><a href="${safeUrl(place.map_url)}" target="_blank" rel="noopener noreferrer">高德地图 ↗</a></div><div class="map-review"><label>我的评分与用餐笔记</label><div class="map-review-stars" role="group" aria-label="给这家店评分">${[1,2,3,4,5].map(score=>`<button type="button" class="${score<=mapState.draft.rating?'active':''}" data-score="${score}" aria-label="${score}星" aria-pressed="${score===mapState.draft.rating?'true':'false'}">★</button>`).join('')}</div><textarea maxlength="180" placeholder="吃过之后记一笔：味道、排队、带娃是否方便……">${escapeHtml(mapState.draft.note)}</textarea><div class="map-review-foot"><small>只保存在这台浏览器，不公开；和高德评分分开。</small><div class="map-review-buttons"><button type="button" class="map-review-clear">清除</button><button type="button" class="map-review-save">保存评价</button></div></div><div class="map-review-status" aria-live="polite">${escapeHtml(mapState.status)}</div></div>`;
  target.querySelector('.map-add').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
      if(saved)state.savedPlaces=state.savedPlaces.filter(item=>item.id!==place.id);
      else{if(!place.route)await placeRoute(place,nearbyRevision);state.savedPlaces.push(place);}
      renderNearby();if(!$('planSection').classList.contains('hidden'))renderTimeline();
    }catch(error){mapState.status='步行路线暂时没查到，稍后再试。';renderMapDetail(place);}
  });
  target.querySelectorAll('[data-score]').forEach(button=>button.addEventListener('click',()=>{const score=Number(button.dataset.score);mapState.draft.rating=mapState.draft.rating===score?0:score;mapState.status='';renderMapDetail(place);}));
  target.querySelector('textarea').addEventListener('input',event=>{mapState.draft.note=event.target.value.slice(0,180);});
  target.querySelector('.map-review-clear').addEventListener('click',()=>{
    mapState.draft={rating:0,note:''};delete mapState.reviews[place.id];
    try{localStorage.setItem('chunguorizi-place-notes-v1',JSON.stringify(mapState.reviews));mapState.status='已清除这家店的评价。';}
    catch{mapState.status='没能更新，请检查浏览器存储权限。';}
    renderNearby();
  });
  target.querySelector('.map-review-save').addEventListener('click',()=>{
    const rating=Number(mapState.draft.rating)||0,note=mapState.draft.note.trim();
    if(rating||note)mapState.reviews[place.id]={rating,note,updated_at:new Date().toISOString()};else delete mapState.reviews[place.id];
    try{localStorage.setItem('chunguorizi-place-notes-v1',JSON.stringify(mapState.reviews));mapState.status='已保存在这台浏览器。';}
    catch{mapState.status='没能保存，请检查浏览器存储权限。';}
    renderNearby();
  });
}
function renderMap(){
  const pins=$('mapPins'),rings=$('mapRings'),choices=$('mapPlaceChoices');pins.replaceChildren();rings.replaceChildren();choices.replaceChildren();
  const hotel=state.hotel,places=state.nearby.filter(place=>/^\d+(\.\d+)?,\d+(\.\d+)?$/.test(place.location||''));
  if(!hotel||!places.length){renderMapDetail(null);return;}
  if(!places.some(place=>place.id===mapState.selectedId)){
    mapState.selectedId=(places.find(place=>place.route?.minutes<=number('walkLimit'))||places[0]).id;mapState.draftId=null;
  }
  const lat=Number(hotel.latitude),lng=Number(hotel.longitude),cos=Math.cos(lat*Math.PI/180);
  const locations=places.map(place=>{const [x,y]=place.location.split(',').map(Number);return{place,dx:(x-lng)*111320*cos,dy:(y-lat)*111320};});
  const maxX=Math.max(250,...locations.map(item=>Math.abs(item.dx))),maxY=Math.max(250,...locations.map(item=>Math.abs(item.dy)));
  const scale=Math.min(.7,350/maxX,235/maxY);
  for(const distance of [500,1000,1500]){
    const radius=distance*scale;if(radius>390)continue;
    rings.append(svgEl('circle',{cx:500,cy:320,r:radius,class:'map-ring'}));
    const label=svgEl('text',{x:505,y:320-radius-7,class:'map-ring-label'});label.textContent=distance>=1000?`${distance/1000} km`:`${distance} m`;rings.append(label);
  }
  for(const {place,dx,dy} of locations){
    const x=500+dx*scale,y=320-dy*scale,selected=place.id===mapState.selectedId;
    const group=svgEl('g',{class:`map-pin${selected?' selected':''}`,transform:`translate(${x} ${y})`,role:'button',tabindex:'0','aria-label':`选择${place.name}`});
    group.append(svgEl('circle',{r:selected?17:12,class:'pin-halo'}),svgEl('circle',{r:selected?6:4,class:'pin-core'}));
    if(selected){const label=svgEl('text',{x:22,y:-15,class:'map-pin-label'});label.textContent=place.name.length>11?place.name.slice(0,11)+'…':place.name;group.append(label);}
    group.addEventListener('click',event=>{event.stopPropagation();chooseMapPlace(place.id);});
    group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();chooseMapPlace(place.id);}});
    pins.append(group);
  }
  const hotelPin=svgEl('g',{class:'map-hotel',transform:'translate(500 320)'});hotelPin.append(svgEl('circle',{r:23}));const glyph=svgEl('text',{x:0,y:1});glyph.textContent='住';hotelPin.append(glyph);pins.append(hotelPin);
  for(const place of places.slice(0,8)){
    const button=document.createElement('button');button.type='button';button.textContent=place.name;button.classList.toggle('active',place.id===mapState.selectedId);button.addEventListener('click',()=>chooseMapPlace(place.id));choices.append(button);
  }
  renderMapDetail(places.find(place=>place.id===mapState.selectedId));mapView();
}
let mapDrag=null;
$('nearbyMap').addEventListener('pointerdown',event=>{
  if(event.target.closest('.map-pin'))return;
  mapDrag={x:event.clientX,y:event.clientY,view:{...mapState.view}};$('nearbyMap').setPointerCapture(event.pointerId);$('nearbyMap').classList.add('dragging');
});
$('nearbyMap').addEventListener('pointermove',event=>{
  if(!mapDrag)return;const rect=$('nearbyMap').getBoundingClientRect();
  mapState.view.x=mapDrag.view.x-(event.clientX-mapDrag.x)*mapDrag.view.w/rect.width;
  mapState.view.y=mapDrag.view.y-(event.clientY-mapDrag.y)*mapDrag.view.h/rect.height;mapView();
});
for(const kind of ['pointerup','pointercancel'])$('nearbyMap').addEventListener(kind,()=>{mapDrag=null;$('nearbyMap').classList.remove('dragging');});
$('nearbyMap').addEventListener('wheel',event=>{event.preventDefault();zoomMap(event.deltaY<0?.82:1.22);},{passive:false});
$('mapZoomIn').addEventListener('click',()=>zoomMap(.78));$('mapZoomOut').addEventListener('click',()=>zoomMap(1.28));$('mapReset').addEventListener('click',resetMapView);
function expandNearbyMap(expanded){
  $('mapExplorer').classList.toggle('expanded',expanded);document.body.classList.toggle('map-open',expanded);
  $('expandMap').textContent=expanded?'收起地图 ×':'展开地图 ↗';$('expandMap').setAttribute('aria-expanded',String(expanded));
  if(expanded){$('mapExplorer').setAttribute('role','dialog');$('mapExplorer').setAttribute('aria-modal','true');$('mapExplorer').setAttribute('aria-labelledby','mapExplorerTitle');$('expandMap').focus();}
  else{$('mapExplorer').removeAttribute('role');$('mapExplorer').removeAttribute('aria-modal');$('mapExplorer').removeAttribute('aria-labelledby');}
  mapView();
}
$('expandMap').addEventListener('click',()=>expandNearbyMap(!$('mapExplorer').classList.contains('expanded')));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('mapExplorer').classList.contains('expanded'))expandNearbyMap(false);});
function renderNearby() {
  const results=$('nearbyResults');results.innerHTML='';
  if(state.nearby.length&&!state.nearby.some(place=>place.id===mapState.selectedId))mapState.selectedId=state.nearby[0].id;
  const closest=state.nearby.filter(place=>place.route).sort((a,b)=>a.route.minutes-b.route.minutes)[0];
  const closestMetric=$('closestWalkMetric');
  if(closestMetric)closestMetric.textContent=closest?`${closest.route.minutes} 分钟`:'待查路线';
  const breakfastMode=document.querySelector('#nearbySection .chip.active')?.dataset.keyword==='早餐';
  const items=[...state.nearby].sort((a,b)=>{
    const rank=p=>p.route?(p.route.minutes<=number('walkLimit')?0:2):1;
    return rank(a)-rank(b)||(breakfastMode?breakfastSignal(b)-breakfastSignal(a):0)||(a.route?.minutes||999)-(b.route?.minutes||999);
  });
  for(const place of items.slice(0,15)) {
    const card=document.createElement('article');card.className='nearby-card';card.classList.toggle('selected',place.id===mapState.selectedId);
    const saved=state.savedPlaces.some(p=>p.id===place.id);
    const routeText=place.route?`步行 ${place.route.minutes} 分钟 · ${place.route.meters} 米`:'步行时间还没查';
    const exceeds=place.route&&place.route.minutes>number('walkLimit');
    const details=[place.rating?`高德评分 ${escapeHtml(place.rating)}`:'',place.cost?`参考人均 ${money(place.cost)}`:'',place.opening_today?`今日参考营业 ${escapeHtml(openingSummary(place.opening_today))}`:''].filter(Boolean).join(' · ');
    const localHint=breakfastSignal(place)>=2?'<span class="local-hint">杭州早点方向 · 供应待核</span>':'';
    const myRating=Number(reviewFor(place).rating)||0;
    card.innerHTML=`${place.photo?`<img class="nearby-photo" src="${safeUrl(place.photo)}" alt="${escapeHtml(place.name)}地点配图" loading="lazy">`:''}<div class="nearby-card-copy">${localHint}<strong>${escapeHtml(place.name)}</strong><p>${escapeHtml(place.address||'地址请看地图')}</p>${details?`<div class="poi-details">${details}</div>`:''}${myRating?`<div class="personal-rating">我的评价 ${'★'.repeat(myRating)}${'☆'.repeat(5-myRating)}</div>`:''}<div class="route-status ${exceeds?'exceeds':''}">${routeText}${exceeds?' · 超出你的步行上限':''}</div><div class="meta">营业、菜单和忌口请向店家确认</div>${place.curated_match?`<div class="city-poi-match">找到同名同道路的餐饮资料${citySource(place.curated_match.sources)}</div>`:''}<div class="nearby-card-actions"><button class="route-button" type="button">${place.route?'刷新路线':'查步行时间'}</button><button class="add-place" type="button">${saved?'已加入候选 ✓':'加入吃饭候选 +'}</button><button class="map-focus" type="button">地图里看 / 评价</button><a href="${safeUrl(place.map_url)}" target="_blank" rel="noopener noreferrer">去地图 ↗</a></div></div>`;
    card.querySelector('.map-focus').addEventListener('click',()=>{chooseMapPlace(place.id);$('mapExplorer').scrollIntoView({behavior:'smooth',block:'start'});});
    card.querySelector('.route-button').addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;button.textContent='计算中…';
      try{await placeRoute(place,nearbyRevision);renderNearby();if(!$('planSection').classList.contains('hidden'))renderTimeline();}
      catch(error){button.textContent='暂时没查到，稍后重试';button.disabled=false;}
    });
    card.querySelector('.add-place').addEventListener('click',async event=>{
      if(saved){state.savedPlaces=state.savedPlaces.filter(p=>p.id!==place.id);renderNearby();renderTimeline();return;}
      if(!place.route){event.currentTarget.disabled=true;event.currentTarget.textContent='先查路线…';try{await placeRoute(place,nearbyRevision);}catch{notice('nearbyNotice','路线暂时不可用，请稍后再试。',true);return;}}
      state.savedPlaces.push(place);renderNearby();if(!$('planSection').classList.contains('hidden'))renderTimeline();
      notice('nearbyNotice',`已把「${place.name}」加入候选。上方每顿饭的下拉里可选择它；${place.route.minutes>number('walkLimit')?'它超出你的步行上限，':''}出发前请确认营业和忌口。`);
    });results.append(card);
  }
  renderMap();
}
async function loadNearby(keyword) {
  const revision=++nearbyRevision;state.nearby=[];$('nearbyResults').innerHTML='';renderMap();
  if(!state.hotel?.longitude||!state.hotel?.latitude){notice('nearbyNotice','酒店位置还不明确，先补完整地址才能算路线。',true);return;}
  notice('nearbyNotice','正在找附近餐馆，并计算前几个地点的步行时间…');
  try{
    const params=new URLSearchParams({lng:state.hotel.longitude,lat:state.hotel.latitude,keyword,city:cityName()});
    const data=await api(`/api/nearby?${params}`);if(revision!==nearbyRevision)return;
    state.nearby=keyword==='早餐'?[...data.items].sort((a,b)=>breakfastSignal(b)-breakfastSignal(a)||(a.straight_line_meters||99999)-(b.straight_line_meters||99999)):data.items;
    renderNearby();
    for(let index=0;index<Math.min(6,state.nearby.length);index+=2){
      await Promise.allSettled(state.nearby.slice(index,index+2).map(place=>placeRoute(place,revision)));
      if(revision!==nearbyRevision)return;renderNearby();
    }
    const reachable=state.nearby.filter(p=>p.route&&p.route.minutes<=number('walkLimit')).length;
    notice('nearbyNotice',data.items.length?`找到 ${data.items.length} 个地点，已查前几个地点的路线，其中 ${reachable} 家在你的 ${number('walkLimit')} 分钟步行范围内。想去的先加入候选。`:'附近没找到合适的地点，换个餐次再试试。');
  }catch(error){if(revision===nearbyRevision)notice('nearbyNotice','附近餐馆暂时没查到：'+error.message,true);}
}

$('screenshot').addEventListener('change',async event=>{
  const files=[...event.target.files||[]];if(!files.length)return;
  if(files.length>3||files.some(file=>file.size>5_000_000)){$('extractStatus').textContent='最多上传 3 张，每张不超过 5 MB。';return;}
  let merged={};const conflicts=[];
  try{
    for(const [index,file] of files.entries()){
      $('extractStatus').textContent=`正在读第 ${index+1}/${files.length} 张截图…`;
      const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
      const result=await api('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image})});
      for(const [key,value] of Object.entries(result.fields)){if(value===null)continue;if(merged[key]!==undefined&&merged[key]!==value)conflicts.push(key);merged[key]=value;}
    }
    state.extracted=merged;state.demo=false;notice('demoNotice','');
    if(merged.city){const city=String(merged.city).replace(/市$/,'');if([...$('city').options].some(option=>option.value===city))$('city').value=city;}
    if(merged.hotel_name)$('query').value=merged.hotel_name;
    if(/^\d{4}-\d{2}-\d{2}$/.test(merged.check_in||''))$('checkIn').value=merged.check_in;
    if(/^\d{4}-\d{2}-\d{2}$/.test(merged.check_out||''))$('checkOut').value=merged.check_out;
    for(const [key,id] of [['room_only_total','roomOnly'],['breakfast_room_total','roomWith'],['breakfast_count_per_night','breakfastCount'],['buffet_rights','mealRights']]){const value=merged[key];if(typeof value==='number'&&Number.isFinite(value))$(id).value=value;}
    if(['lunch','dinner','either'].includes(merged.buffet_meal_type))$('mealRightType').value=merged.buffet_meal_type;
    $('comparable').checked=false;
    $('extractStatus').textContent=`已读出可见信息${merged.platform?' · '+(/携程|ctrip|trip\.com/i.test(merged.platform)?'订房平台截图':merged.platform):''}${merged.room_type?' · '+merged.room_type:''}。请点“找酒店”确认位置，再核对价格与份数。${conflicts.length?'多张图片存在不同值，已填最后一张可见值，请检查。':''}`;
  }catch(error){$('extractStatus').textContent='截图暂时没读完：'+error.message+'。也可以直接填写价格。';}
  event.target.value='';
});

function number(id) { const value = $(id).value; return value === '' ? null : Number(value); }
function nights() { const start = new Date(`${$('checkIn').value}T12:00:00`); const end = new Date(`${$('checkOut').value}T12:00:00`); return Math.round((end-start)/86_400_000); }
function stays() {
  const count = nights(); if (!Number.isFinite(count) || count < 1 || count > 30) return [];
  const start = new Date(`${$('checkIn').value}T12:00:00`);
  return Array.from({length: count}, (_, i) => {const date = new Date(start);date.setDate(date.getDate()+i);return day(date);});
}

function breakfastUseDays(){const n=nights(),value=number('breakfastDays');return value===null?n:Math.min(n,Math.max(0,Math.floor(value)));}
function breakfastDecision() {
  return compareBreakfast({plain:number('roomOnly'),included:number('roomWith'),adults:number('adults'),children:number('children'),count:number('breakfastCount'),days:breakfastUseDays(),nights:nights(),budget:number('outsideBudget'),comparable:$('comparable').checked});
}
function syncBreakfastDates() {
  const dates=breakfastDates($('checkIn').value,$('checkOut').value),days=breakfastUseDays();
  const signature=[$('checkIn').value,$('checkOut').value,days].join('|');
  if(signature!==breakfastDateSignature){selectedBreakfastDates.clear();dates.slice(0,days).forEach(date=>selectedBreakfastDates.add(date));breakfastDateSignature=signature;}
  return dates;
}
function renderBreakfastComparison() {
  const dates=syncBreakfastDates(),decision=breakfastDecision();
  const usable=['ready','children-unknown','missing-budget'].includes(decision.status);
  const family=decision.status==='children-unknown';
  const earliest=state.hotelPolicy?.policies.map(policy=>policy.start_time).filter(Boolean).sort()[0];
  const departure=$('morningDeparture').value;
  const timingWarning=departure&&earliest&&departure<=earliest&&selectedBreakfastDates.size?`<p class="breakfast-time-warning">你通常 ${escapeHtml(departure)} 出门，公开参考早餐最早 ${escapeHtml(earliest)} 开始。先问酒店能否提前或打包；否则，把赶车的日期改为外出，别把吃不到的早餐算进去。</p>`:'';
  $('breakfastComparison').innerHTML=`<div class="decision-heading"><div><span class="mini-label">MAKE IT WORTH YOUR MORNING</span><h3>把早餐钱，算到每一个早晨</h3><p>${family?'以下只比较成人；儿童费用与权益未确认。':'含早套餐按全程付钱，真正吃几次由你决定。'}</p></div><span class="decision-badge">可调整 · 即时重算</span></div><div class="breakfast-calendar" role="group" aria-label="选择在酒店吃早餐的日期">${dates.map(date=>`<button type="button" class="breakfast-day ${selectedBreakfastDates.has(date)?'active':''}" data-breakfast-date="${date}" aria-pressed="${selectedBreakfastDates.has(date)}"><span>${date.slice(5).replace('-','月')}日</span><b>${selectedBreakfastDates.has(date)?'酒店早餐':'留给外出'}</b><small>${date===$('checkOut').value?'退房日':'住店日'}</small></button>`).join('')}</div>${timingWarning}<p class="calendar-help">点日期切换吃法。默认先安排前几个早晨；早餐权益、菜单和营业时间仍需核对。</p>${usable?`<div class="breakfast-options"><article><span>不含早 + 全部外出</span><strong>${decision.outsideAll===null?'填外出预算':money(decision.outsideAll)}</strong><p>${number('adults')}位成人 × ${dates.length}个早晨${number('outsideBudget')!==null?` × ${money(number('outsideBudget'))}/人`:''}</p></article><article><span>含早 + 剩余早晨外出</span><strong>${decision.packageAll===null?'填外出预算':money(decision.packageAll)}</strong><p>套餐增量 ${money(decision.premium)} + ${dates.length-selectedBreakfastDates.size}次外出预算</p></article></div><p class="comparison-scope">两边都是房费之外的早餐增量预算，未含儿童、交通与其他餐费；${state.demo?'当前使用示例价格。':'按你确认的同条件价格计算。'}</p><div class="break-even"><span>含早的持平点</span><strong>${money(decision.threshold.toFixed(2))} / 成人 / 次</strong><p>外出早餐人均低于这个数，更省钱；高于这个数，含早费用更低。省心和当地味，由你衡量。</p></div><details class="breakfast-scenarios"><summary>如果多吃几次酒店早餐，会怎样？</summary><div>${decision.scenarios.map(item=>`<button type="button" data-breakfast-days="${item.days}" class="${item.days===selectedBreakfastDates.size?'active':''}"><span>用${item.days}次</span><b>${money(item.perUse.toFixed(2))}</b><small>/成人/次</small></button>`).join('')}</div><p>只改变实际使用次数，套餐增量保持 ${money(decision.premium)}。</p></details>`:`<div class="comparison-incomplete"><strong>${escapeHtml(breakfastAssessment().headline)}</strong><p>${decision.status==='unused'?'你已把所有早晨留给外出。点选日期可重新比较。':'先核对价格、份数和可比条件，再显示金额比较；日期安排可以先选。'}</p></div>`}`;
  $('breakfastComparison').querySelectorAll('[data-breakfast-date]').forEach(button=>button.addEventListener('click',()=>{
    const date=button.dataset.breakfastDate;
    if(selectedBreakfastDates.has(date))selectedBreakfastDates.delete(date);else{selectedBreakfastDates.add(date);mealSelections.delete(date+'早餐');}
    updateBreakfastSelection();
  }));
  $('breakfastComparison').querySelectorAll('[data-breakfast-days]').forEach(button=>button.addEventListener('click',()=>{
    selectedBreakfastDates.clear();dates.slice(0,Number(button.dataset.breakfastDays)).forEach(date=>{selectedBreakfastDates.add(date);mealSelections.delete(date+'早餐');});updateBreakfastSelection();
  }));
}
function updateBreakfastSelection() {
  $('breakfastDays').value=selectedBreakfastDates.size;
  breakfastDateSignature=[$('checkIn').value,$('checkOut').value,selectedBreakfastDates.size].join('|');
  const breakfast=breakfastAssessment();
  $('breakfastHeadline').textContent=breakfast.headline;$('breakfastDetails').innerHTML=breakfast.html+publicBreakfastPolicy();
  renderOverview(breakfast);renderBreakfastComparison();renderTimeline();
  setResultTab(document.querySelector('[data-result-tab].active')?.dataset.resultTab||'all');
  const previousList=$('aiExplainResult').querySelector('ul');
  if(previousList)$('aiExplainResult').replaceChildren(previousList);else $('aiExplainResult').replaceChildren();
  explainRevision++;$('aiExplainStatus').textContent=$('aiExplainResult').innerText?'早餐日期与金额已更新；下方为此前的清单，可点击“更新核对清单”。':'早餐日期与金额已更新。点击“更新核对清单”，或直接复制问店的话。';
}
function publicBreakfastPolicy(){
  const item=state.hotelPolicy;if(!item?.policies?.length)return '';
  const days={daily:'每天','Mon-Fri':'周一至周五','Sat-Sun':'周六至周日'};
  const lines=item.policies.slice(0,4).map(p=>`${days[p.weekdays]||p.weekdays} ${p.start_time&&p.end_time?`${p.start_time}–${p.end_time}`:'时段待核'}${p.adult_price!==null?` · 成人单买参考 ${money(p.adult_price)}`:''}`);
  const unique=[...new Set(lines)];
  const child=number('children')>0&&item.child_rules.length?`<p>儿童公开规则：${item.child_rules.slice(0,5).map(r=>escapeHtml(r.raw_rule)).join('；')}。以实际身高/年龄与本次商品条款为准。</p>`:'';
  const source=item.policies[0].source;
  const departure=$('morningDeparture').value;
  const earliest=item.policies.map(p=>p.start_time).filter(Boolean).sort()[0];
  const departureNote=departure&&earliest&&departure<=earliest?`<p>你计划 ${escapeHtml(departure)} 出门，参考早餐最早 ${escapeHtml(earliest)} 开始；这天可能赶不上。</p>`:'';
  const official=item.official_breakfast;
  const officialHtml=official?`<div class="official-breakfast"><strong>酒店官网 · ${escapeHtml(official.restaurant)}</strong><p>${escapeHtml(official.summary)}</p><p>${escapeHtml(official.hours)}</p><p>${escapeHtml(official.family_note)}</p><small>${escapeHtml(official.checked_at)} 查阅官网；菜单、价格、时段与房型权益以入住日为准。</small><a href="${safeUrl(official.source_url)}" target="_blank" rel="noopener noreferrer">查看酒店官网 ↗</a>${official.extra_source_url?`<a href="${safeUrl(official.extra_source_url)}" target="_blank" rel="noopener noreferrer">查看套餐条件 ↗</a>`:''}</div>`:'';
  return `<details class="policy-note"><summary>看看这家酒店的早餐、时段与儿童政策</summary>${officialHtml}<strong>公开早餐政策参考</strong><p>${unique.map(escapeHtml).join('；')}</p>${child}${departureNote}<small>网络公开酒店政策资料 · ${escapeHtml(item.collected_at)} 采集；房型权益和当前价格以飞猪预订页及酒店确认为准。</small><a href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer">查看政策来源 ↗</a></details>`;
}
function breakfastAssessment() {
  const n=nights(),plain=number('roomOnly'),withBreakfast=number('roomWith'),count=number('breakfastCount');
  const adults=number('adults')||1,kids=number('children')||0,outside=number('outsideBudget'),days=breakfastUseDays();
  const officialServices=state.evidence?.venues.flatMap(v=>v.services).filter(service=>service.meal_type==='breakfast')||[];
  const opening=officialServices.find(service=>service.start_time&&service.end_time);
  const departure=$('morningDeparture').value;
  const timeNote=state.hotelPolicy?'':departure?opening&&departure<=opening.start_time?`<p>你计划 ${escapeHtml(departure)} 出门，资料里的早餐 ${escapeHtml(opening.start_time)} 才开始；这天可能赶不上。先向酒店确认打包早餐或调整可用天数。</p>`:opening?`<p>资料中的早餐时段 ${escapeHtml(opening.start_time)}–${escapeHtml(opening.end_time)}，你 ${escapeHtml(departure)} 出门。请给用餐留出时间，并确认入住日的实际时段。</p>`:'<p>已考虑你填写的出门时间，但酒店早餐时段还不明确，订前先问是否来得及。</p>':'';
  if(plain===null||withBreakfast===null)return {headline:'补上两档价格，就能算清差价',html:'<p>填同日期、同房型的不含早与含早全程总价。只有一档价格时，我们先帮你找吃饭选择。</p>'+timeNote};
  const delta=withBreakfast-plain;if(delta<0)return {headline:'含早反而更便宜，先核对条款',html:'<p>价格可能混有其他促销、房型或取消规则，确认后再比较。</p>'};
  const detail=`<p>含早全程多 ${money(delta)}，平均每晚 ${money((delta/n).toFixed(2))}。</p>`;
  if(!$('comparable').checked)return {headline:'价差算出来了，先确认房型可比',html:detail+'<p>两档的房型、取消规则或其他权益不同时，差额不能全部算作早餐钱。</p>'+timeNote};
  if(days===0)return {headline:'这趟用不上酒店早餐',html:detail+'<p>你填了 0 天能使用酒店早餐。按目前安排，增加含早权益没有帮你解决用餐；可以先选不含早，再安排外出早餐。</p>'+timeNote};
  if(count===null||count===0)return {headline:'先问每晚给几份早餐',html:detail+'<p>还不知道份数，无法判断同行人是否覆盖。</p>'+timeNote};
  if(count<adults)return {headline:'含早份数不够所有成人',html:detail+`<p>${adults} 名成人，每天只有 ${count} 份；还需要补问额外早餐价。</p>`+timeNote};
  const actual=`<p>你预计吃 ${days} 天酒店早餐。按 ${adults} 位成人使用，实际增量约 ${money((delta/(days*adults)).toFixed(2))} / 人 / 次。</p>`;
  if(kids)return {headline:'带娃先算儿童收费，别多买一份',html:detail+actual+`<p>同行有 ${kids} 名儿童${$('childAges').value?'（年龄 '+escapeHtml($('childAges').value)+'）':''}。儿童按年龄还是身高收费、能否使用套餐份数还没确认，所以目前不给全家总价结论。</p>`+timeNote};
  if(outside===null)return {headline:'早餐实际单次成本已算好',html:detail+actual+'<p>再填外出早餐的人均预算，就能比较。附近店要确认营业、路线和你的忌口。</p>'+timeNote};
  const comparableOutside=outside*adults*days,difference=delta-comparableOutside;
  const preferred=$('mealPriority').value;
  const preferenceNote=preferred==='easy'?'你更在意省心：带行李、下雨或早上赶时间时，少一次外出也有价值。':preferred==='local'?'你更想尝当地味：可以留一两个早晨给街头小吃，同时减少酒店早餐的实际使用天数再算一遍。':'你更在意预算：先看这份差额，再确认外出餐馆实际菜单价格。';
  const headline=difference===0?'按你填的预算，两种吃法费用相同':difference>0?'按你填的预算，外出早餐省一些':'按你填的预算，含早更划算';
  const comparison=`<p>只比较这 ${days} 次早餐：外出预算约 ${money(comparableOutside)}，${difference===0?'与含早增量相同':`${difference>0?'比含早增量少':'比含早增量多'} ${money(Math.abs(difference))}`}。其他早晨的外出花费两边相同。</p>`;
  return {headline,html:detail+actual+comparison+`<p>${preferenceNote}</p>`+timeNote};
}
function renderOverview(breakfast) {
  const n=nights(),days=breakfastUseDays(),delta=number('roomOnly')!==null&&number('roomWith')!==null?number('roomWith')-number('roomOnly'):null;
  const decision=breakfastDecision();
  const per=decision.perUse!==undefined?money(decision.perUse.toFixed(2)):'暂不能比较';
  const closest=state.nearby.filter(place=>place.route).sort((a,b)=>a.route.minutes-b.route.minutes)[0];
  $('resultTripSummary').textContent=`${state.hotel.name} · ${cityName()} · ${n} 晚 · ${number('adults')} 成人${number('children')?' + '+number('children')+' 儿童':''}${state.demo?' · 示例价格':''}`;
  const preference={local:'想尝当地味，给外出吃饭留一点空间。',easy:'更在意省心，先考虑酒店早餐和短距离外出。',budget:'先看确定的价差，把每顿饭花在哪儿看清楚。'}[$('mealPriority').value];
  $('planOverview').innerHTML=`<strong>${escapeHtml(breakfast.headline)}</strong><p>${preference}${state.demo?' 当前房价是示例测试值。':''}金额按你填写的价格和实际使用次数计算。</p><div class="plan-metrics"><div><span>含早全程增量</span><b>${delta===null||delta<0?'待核对':money(delta)}</b></div><div><span>实际每位成人每次</span><b>${per}</b></div><div><span>最近已查路线的餐馆</span><b id="closestWalkMetric">${closest?closest.route.minutes+' 分钟':state.nearby.length?'路线待查':'暂无路线'}</b></div></div>`;
}
$('walkLimit').addEventListener('change',()=>{renderNearby();if(!$('planSection').classList.contains('hidden'))renderOverview(breakfastAssessment());});
$('refreshQuestions').addEventListener('click',()=>loadPlanExplanation(breakfastAssessment(),buffetAssessment()));
$('copyQuestions').addEventListener('click',async()=>{
  const questions=[`您好，我们有 ${number('adults')} 位成人、${number('children')||0} 位儿童，想确认以下信息：`];
  if(number('children'))questions.push(`儿童年龄 ${$('childAges').value||'待补'}，早餐按年龄还是身高收费？套餐早餐份数是否可用于儿童？`);
  questions.push('这个房价每天包含几份早餐？早餐开始、结束时间是几点？');
  if($('morningDeparture').value)questions.push(`我们预计 ${$('morningDeparture').value} 出门，能否提前用餐或提供打包早餐？`);
  if(number('mealRights'))questions.push(`套餐中的 ${number('mealRights')} 次用餐权益，每次覆盖几人？适用哪家餐厅和餐次？入住日是否可用、需要提前多久预约？`);
  if($('dietary').value)questions.push(`我们的饮食要求是：${$('dietary').value}。请确认可提供哪些菜品，是否存在相关过敏原或交叉接触。`);
  try{await navigator.clipboard.writeText(questions.join('\n'));$('copyQuestions').textContent='已复制 ✓';}catch{$('aiExplainResult').textContent=questions.join('\n');}
});
$('savePlan').addEventListener('click',()=>{
  const content=['纯过日子 · 我的吃饭方案',$('resultTripSummary').innerText,state.demo?'示例房价与权益为测试值。':'价格基于本次填写，非平台最终报价。',$('planOverview').innerText,$('breakfastComparison').innerText,$('breakfastDetails').innerText,$('buffetDetails').innerText,$('aiExplainResult').innerText,'逐餐候选（营业、菜单与忌口请另确认）',$('timeline').innerText,'餐馆候选',...state.savedPlaces.map(place=>{const review=reviewFor(place);return `${place.name} | ${place.address} | 步行 ${place.route?.minutes??'?'} 分钟 | ${place.map_url}${review.rating||review.note?`\n我的评价：${review.rating?'★'.repeat(review.rating):'未评分'} ${review.note||''}`:''}`;})].join('\n\n');
  const blob=new Blob([content],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='纯过日子-吃饭方案.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

$('sharePlan').addEventListener('click', async () => {
  const decision=breakfastDecision(), dates=syncBreakfastDates();
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1440;
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  ctx.fillStyle='#f7f4eb';ctx.fillRect(0,0,1080,1440);
  const heading=(text,y,size=34,color='#183f35')=>{ctx.font=`600 ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;ctx.fillStyle=color;ctx.fillText(text,64,y);};
  const lines=(text,y,size=25,color='#647467')=>{
    ctx.font=`${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;ctx.fillStyle=color;
    let line='';
    for(const char of text){if(ctx.measureText(line+char).width>950){ctx.fillText(line,64,y);line=char;y+=size*1.6;}else line+=char;}
    if(line){ctx.fillText(line,64,y);y+=size*1.6;}return y;
  };
  heading('纯过日子',100,43);heading('订酒店，也把饭算明白',152,26,'#9f7152');
  ctx.strokeStyle='#dce2d2';ctx.beginPath();ctx.moveTo(64,190);ctx.lineTo(1016,190);ctx.stroke();
  let y=lines(state.hotel.name,258,38,'#183f35');
  y=lines(`${$('checkIn').value} — ${$('checkOut').value} · ${number('adults')} 成人${number('children')?' + '+number('children')+' 儿童':''}`,y+18,25);
  y=lines(breakfastAssessment().headline,y+42,31,'#183f35');
  if(decision.outsideAll!==undefined&&decision.outsideAll!==null){
    y=lines(`成人早餐增量预算：全部外出 ${money(decision.outsideAll)}；含早与剩余外出 ${money(decision.packageAll)}。`,y+16,29);
  }
  if(decision.perUse!==undefined)y=lines(`含早全程多 ${money(decision.premium)}，实际用 ${selectedBreakfastDates.size} 次：${money(decision.perUse.toFixed(2))}/成人/次。`,y+12,28,'#9f7152');
  if(number('children'))y=lines('儿童收费与套餐份数待核；上述金额不是全家总价。',y+8,25,'#9f7152');
  y+=30;heading('早晨留给谁',y,30);y+=42;
  const shownDates=dates.slice(0,5);
  for(const date of shownDates){
    const place=state.savedPlaces.find(place=>place.id===mealSelections.get(date+'早餐'));
    y=lines(`${date.slice(5)}  ${selectedBreakfastDates.has(date)?'酒店早餐（权益待核）':place?place.name+'（外出候选）':'外出早餐，门店待选'}`,y,25);
  }
  if(dates.length>shownDates.length)y=lines(`另有 ${dates.length-shownDates.length} 个早晨，完整安排见文字方案。`,y,23);
  if(state.savedPlaces.length&&y<1110){y+=22;heading('想去的店',y,30);y+=42;for(const place of state.savedPlaces.slice(0,2))y=lines(`${place.name}${place.route?' · 从酒店步行 '+place.route.minutes+' 分钟':''}`,y,25);}
  ctx.fillStyle='#eaf0e5';ctx.fillRect(0,1260,1080,180);
  lines(state.demo?'示例价格与权益为测试值；酒店资料另有真实出处。':'按本次填写的价格与同条件确认计算，非平台最终报价。',1310,22);
  lines('门店营业、菜单、儿童政策、忌口与套餐适用条件，出发前向商家确认。',1365,22);
  canvas.toBlob(blob=>{
    if(!blob)return;
    const url=URL.createObjectURL(blob),dialog=document.createElement('dialog');dialog.className='share-dialog';
    dialog.innerHTML='<div class="share-dialog-heading"><h3>一起决定，早上怎么吃</h3><button type="button" aria-label="关闭分享卡">×</button></div><p>这张卡只在你的浏览器生成。保存图片后，可以发给同行人。</p><img alt="本次酒店早餐预算与逐日安排分享卡"><a class="primary" download="纯过日子-同行分享卡.png">保存图片 ↓</a>';
    dialog.querySelector('img').src=url;dialog.querySelector('a').href=url;
    dialog.querySelector('button').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{dialog.remove();URL.revokeObjectURL(url);});
    document.body.append(dialog);dialog.showModal();
  },'image/png');
});

function buffetAssessment() {
  if (!state.evidence) return {headline:'这家酒店的自助餐待核验', html:'<p>已能按酒店位置找附近餐饮，但暂时没有该酒店的官方自助餐价格与规则。可以上传飞猪套餐截图或打开商品页核对。</p>'};
  const services = state.evidence.venues.flatMap(v => v.services.map(s => ({...s, venue:v})));
  const buffets = services.filter(s => ['lunch','dinner','brunch'].includes(s.meal_type) && ['buffet','mixed'].includes(s.service_format));
  const offers = state.evidence.offers.filter(o => buffets.some(s => s.service_id === o.service_id));
  const dietary = $('dietary').value.trim();
  const dietaryNote = dietary ? `<p>你填写了「${escapeHtml(dietary)}」。现有资料无法证明过敏原与交叉接触安全，预订前须向餐厅核实。</p>` : '';
  if (!buffets.length) return {headline:'没有核实到酒店自助午晚餐', html:'<p>可以从周边餐饮地点找替代；高德地点存在不代表菜单或营业时间已核实。</p>'+dietaryNote};
  const lines = buffets.slice(0, 3).map(s => `<li>${escapeHtml(s.venue.name)} · ${s.meal_type === 'lunch' ? '午餐' : s.meal_type === 'dinner' ? '晚餐' : '早午餐'} · ${escapeHtml(s.weekdays && s.weekdays !== '未知' ? s.weekdays : '营业日请确认')} ${escapeHtml(s.start_time && s.end_time ? `${s.start_time}–${s.end_time}` : '用餐时段请确认')}</li>`).join('');
  const price = offers.length ? `<p>酒店官网参考价格：${offers.map(o => `${escapeHtml(o.title)} ${money(o.price)}`).join('；')}。是否适用入住日、儿童和预约规则仍要核对。</p>` : '<p>还没有当前套餐价。补一张价格和权益截图，就能继续核对是否用得上。</p>';
  const source = buffets[0].venue.sources?.[0];
  return {headline:offers.length ? '有价格可比较，先看适用条件' : '自助餐存在，价格待确认', html:`<ul>${lines}</ul>${price}${dietaryNote}${source ? citySource([source]) : ''}`};
}

const mealSelections=new Map();
function addMeal(date, type, title, note, stateText, unknown = false) {
  const row = document.createElement('div'); row.className = 'meal-row';row.dataset.mealType=type;
  row.innerHTML = `<time>${escapeHtml(date.slice(5))}</time><span class="meal-type">${escapeHtml(type)}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(note)}</p></div><span class="meal-state ${unknown ? 'unknown' : ''}">${escapeHtml(stateText)}</span>`;
  if(state.savedPlaces.length&&type!=='提示'){
    const select=document.createElement('select');select.className='meal-choice';select.setAttribute('aria-label',`${date} ${type}餐馆候选`);
    select.append(new Option('选一家外出餐馆（候选）',''));
    state.savedPlaces.forEach(place=>select.append(new Option(`${place.name} · 步行 ${place.route?.minutes??'?'} 分钟`,place.id)));
    const key=date+type;select.value=mealSelections.get(key)||'';
    select.addEventListener('change',()=>{mealSelections.set(key,select.value);const place=state.savedPlaces.find(p=>p.id===select.value);if(place){if(type==='早餐'&&selectedBreakfastDates.has(date)){selectedBreakfastDates.delete(date);updateBreakfastSelection();return;}row.querySelector('strong').textContent=place.name;row.querySelector('p').textContent=`从酒店步行 ${place.route?.minutes??'?'} 分钟；营业、菜单、忌口与本餐次供应请确认。`;row.querySelector('.meal-state').textContent='外出候选';}else{renderTimeline();}});
    row.querySelector('strong').parentElement.append(select);
    if(select.value){const place=state.savedPlaces.find(p=>p.id===select.value);row.querySelector('strong').textContent=place.name;row.querySelector('p').textContent=`从酒店步行 ${place.route?.minutes??'?'} 分钟；营业、菜单和忌口请确认。`;row.querySelector('.meal-state').textContent='外出候选';}
  }
  $('timeline').append(row);
}

function weekdayStatus(date, rule) {
  if (!rule || rule === '未知') return 'unknown';
  if (['daily', '每日'].includes(rule)) return 'open';
  const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const index = new Date(`${date}T12:00:00`).getDay();
  const dayName = names[index];
  const chinese = {'周一至周五':[1,2,3,4,5],'周六至周日':[6,0],'周四至周日':[4,5,6,0]};
  if (chinese[rule]) return chinese[rule].includes(index) ? 'open' : 'closed';
  if (rule === dayName) return 'open';
  const parts = rule.split('-');
  if (parts.length === 2 && parts.every(part => names.includes(part))) {
    let cursor = names.indexOf(parts[0]);
    for (let i = 0; i < 7; i++, cursor = (cursor + 1) % 7) {
      if (cursor === index) return 'open';
      if (names[cursor] === parts[1]) break;
    }
    return 'closed';
  }
  return 'unknown';
}

function renderTimeline() {
  $('timeline').innerHTML = '';
  const dates = stays();
  syncBreakfastDates();
  const onsite = state.evidence?.venues.flatMap(v => v.services.map(s => ({...s, venue:v}))) || [];
  function matchingService(date, type) {
    const candidates = onsite.filter(s => s.meal_type === type && weekdayStatus(date, s.weekdays) !== 'closed');
    return candidates.find(s => weekdayStatus(date, s.weekdays) === 'open') || candidates[0] || null;
  }
  let rights = number('mealRights'); rights = rights === null ? 0 : Math.max(0, rights);
  const rightType = $('mealRightType').value;
  function mealOption(date, type) {
    const onsiteItem = matchingService(date, type);
    const canUseRight = rights > 0 && onsiteItem && (rightType === type || rightType === 'either');
    if (canUseRight) rights--;
    const title = onsiteItem ? `${onsiteItem.venue.name}（酒店内候选）` : `外出${type === 'dinner' ? '晚餐' : '午餐'}待选`;
    const weekdayNote = onsiteItem && weekdayStatus(date, onsiteItem.weekdays) === 'unknown' ? '营业星期待核；' : '';
    const note = canUseRight ? `${weekdayNote}暂为这顿预留 1 次套餐权益；适用餐厅、日期、人数与规则仍需核对` : onsiteItem ? `${weekdayNote}餐厅/餐次来自酒店资料；价格和预约需核对` : '在下方按餐次筛选周边地点；确认菜单、营业时间与真实步行路线后再选';
    addMeal(date, type === 'dinner' ? '晚餐' : '午餐', title, note, canUseRight ? '权益待确认' : '待核价', true);
  }
  dates.forEach((date, index) => {
    if (index > 0) {
      const breakfast = matchingService(date, 'breakfast');
      const preferOutside=!selectedBreakfastDates.has(date);
      const title = preferOutside ? '找一顿外出早餐' : breakfast ? `${breakfast.venue.name} · 早餐（可调整）` : '早餐地点待选';
      addMeal(date, '早餐', title, preferOutside?'可以从下方加入餐馆候选；先确认早餐供应、营业和忌口。':`${breakfast && weekdayStatus(date, breakfast.weekdays) === 'unknown' ? '营业日请确认；' : ''}以房型是否含早、份数和时间为准`, '待核权益', true);
      mealOption(date, 'lunch');
    }
    mealOption(date, 'dinner');
  });
  const checkout = new Date(`${$('checkOut').value}T12:00:00`);
  if (Number.isFinite(checkout.getTime())) {
    const breakfast = matchingService(day(checkout), 'breakfast');
    const preferOutside=!selectedBreakfastDates.has(day(checkout));
    const title = preferOutside ? '退房日外出早餐' : breakfast ? `${breakfast.venue.name} · 早餐（可调整）` : '退房日早餐待选';
    addMeal(day(checkout), '早餐', title, preferOutside?'如果要赶车，提前确认开门时间和步行路线。':'退房日仍需核对早餐权益和开放时间', '待核权益', true);
  }
  if (rights > 0) addMeal($('checkOut').value, '提示', '仍有未分配的套餐权益', `剩余 ${rights} 次；可能需另选适用日期或餐次。`, '待确认', true);
}

async function loadPlanExplanation(breakfast, buffet) {
  const revision = ++explainRevision;
  $('aiExplainResult').innerHTML = '';
  if (state.demo) {
    const checks = [
      '确认入住当天附近餐馆是否营业，以及早餐供应到几点。',
      number('children') ? '向酒店确认儿童早餐份数、年龄或身高收费规则。' : '核对含早份数和实际计划在酒店用早餐的天数。',
      $('dietary').value.trim() ? '把忌口和过敏要求逐项发给餐厅确认。' : '出发前核对套餐适用日期、人数和预约规则。'
    ];
    $('aiExplainStatus').textContent = '示例讲解 · 固定内容，不调用百炼；用自己的行程可体验实时分析。';
    $('aiExplainResult').innerHTML = `<strong>${escapeHtml(breakfast.headline)}；${escapeHtml(buffet.headline)}</strong><p>下面是示例行程的核对清单，真实预订仍以商品和商家说明为准。</p><ul>${checks.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    return;
  }
  $('aiExplainStatus').textContent = '正在整理最值得先问清的几件事…';
  const payload = {
    nights: nights(), breakfast_use_days: breakfastUseDays(), morning_departure: $('morningDeparture').value, adults: number('adults'), children: number('children'),
    breakfast_count_per_night: number('breakfastCount'),
    room_only_total: number('roomOnly'), breakfast_room_total: number('roomWith'),
    outside_budget_per_person: number('outsideBudget'), same_room_terms: $('comparable').checked,
    hotel_breakfast_result: breakfast.headline, hotel_buffet_result: buffet.headline,
    hotel_buffet_official_evidence: Boolean(state.evidence?.offers.some(offer => offer.offer_type === 'official_price')),
    buffet_rights: number('mealRights'),
    has_dietary_restrictions: Boolean($('dietary').value.trim()),
    matched_nearby_count: state.nearby.filter(place => place.curated_match).length,
    walk_limit_minutes: number('walkLimit')
  };
  try {
    const result = await api('/api/explain', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
    if (revision !== explainRevision) return;
    $('aiExplainStatus').textContent = '可以把下面的话发给酒店或餐厅，核对后再决定。';
    $('aiExplainResult').innerHTML = `<strong>${escapeHtml(result.summary || '当前信息还不足以给出更明确结论')}</strong><p>${escapeHtml(result.reason)}</p>${result.checklist.length ? `<ul>${result.checklist.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}`;
  } catch (error) {
    if (revision !== explainRevision) return;
    $('aiExplainStatus').textContent = error.status === 429
      ? error.message : '问店清单暂时无法生成，上方价格计算可以继续看。';
  }
}

$('makePlan').addEventListener('click', () => {
  if (!state.hotel) {notice('searchNotice', '请先查找并选择酒店。', true);window.scrollTo({top:0,behavior:'smooth'});return;}
  if (stays().length === 0) {showPane('preferences');notice('preferenceNotice', '入住与退房日期需相隔 1–30 晚，请返回住处页修改日期。', true);return;}
  const inputs=['adults','children','roomOnly','roomWith','breakfastCount','outsideBudget','breakfastDays','mealRights'];
  const invalid=inputs.map($).find(input=>!input.checkValidity());
  if(invalid || (number('breakfastDays')!==null&&number('breakfastDays')>nights())){showPane('preferences');notice('preferenceNotice',invalid?'请检查人数、份数、天数和价格是否在允许范围内。':'酒店早餐天数不能超过住宿晚数。',true);invalid?.focus();return;}
  notice('preferenceNotice','');
  const b = breakfastAssessment(), f = buffetAssessment();
  b.html+=publicBreakfastPolicy();
  $('breakfastHeadline').textContent = b.headline; $('breakfastDetails').innerHTML = b.html;
  $('buffetHeadline').textContent = f.headline; $('buffetDetails').innerHTML = f.html;
  renderOverview(b); renderBreakfastComparison(); renderTimeline(); $('planSection').classList.remove('hidden');showPane('result');
  setResultTab('all');
  loadPlanExplanation(b, f);
  window.scrollTo({top:0,behavior:'smooth'});
});
function setResultTab(tab){
  document.querySelectorAll('[data-result-tab]').forEach(button=>button.classList.toggle('active',button.dataset.resultTab===tab));
  document.querySelectorAll('#timeline .meal-row').forEach(row=>row.classList.toggle('hidden',tab==='breakfast'&&row.dataset.mealType!=='早餐'));
  if(tab==='restaurants')$('nearbySection').scrollIntoView({behavior:'smooth',block:'start'});
}
document.querySelectorAll('[data-result-tab]').forEach(button=>button.addEventListener('click',()=>setResultTab(button.dataset.resultTab)));
