(() => {
const $=id=>document.getElementById(id), dbName='MoyaZarplataDB', store='days';
let db, orders=[], missed=[], currentMonth='';
let scannerControls=null, scannerReader=null, scanTargetIndex=null, ocrBusy=false, scannerDuplicateWarned=false;
const rates={salary:43400,kg:0.87,point:22.20,tek:0.5,overtime:500,taxRate:0.13};
function fillSettingsInputs(){
 $('settingSalary').value=rates.salary;
 $('settingKg').value=rates.kg;
 $('settingPoint').value=rates.point;
 $('settingTek').value=Number((rates.tek*100).toFixed(2));
 $('settingOvertime').value=rates.overtime;
 $('settingTax').value=Number((rates.taxRate*100).toFixed(2));
}
async function saveRateSettings(){
 const token=localStorage.getItem('MZ_API_TOKEN');
 if(!token){$('settingsMessage').textContent='Сначала сохраните API-токен в разделе Google Sheets.';return;}
 const values={
  salary:Number($('settingSalary').value),
  kg:Number($('settingKg').value),
  point:Number($('settingPoint').value),
  tek:Number($('settingTek').value)/100,
  overtime:Number($('settingOvertime').value),
  taxRate:Number($('settingTax').value)/100
 };
 if(Object.values(values).some(v=>!Number.isFinite(v)||v<0)){
  $('settingsMessage').textContent='Проверьте значения: они должны быть неотрицательными числами.';return;
 }
 if(values.tek>1||values.taxRate>1){
  $('settingsMessage').textContent='Проценты должны быть в диапазоне от 0 до 100.';return;
 }
 $('settingsMessage').textContent='Сохраняем параметры в Google Таблицу…';
 try{
  const result=await api('saveSettings',{settings:values});
  Object.assign(rates,result.settings||values);
  fillSettingsInputs();
  await renderMonth();
  await renderStats();
  renderCalc();
  $('settingsMessage').textContent='Параметры сохранены в Google Таблице.';
 }catch(err){
  $('settingsMessage').textContent='Не удалось сохранить параметры: '+err.message;
 }
}
// Резервный адрес API на случай, если config.js не загрузился.
const APP_SCRIPT_API_URL='https://script.google.com/macros/s/AKfycbxrroyVWZ19npF_73tbRfNGKSiwakWNurOvN5Mm1NaKC0pWU31MzydysRLmZ2DgfmVb/exec';
const rub=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n)+' ₽';
const today=new Date(), pad=n=>String(n).padStart(2,'0');
const monthNow=`${today.getFullYear()}-${pad(today.getMonth()+1)}`;

function localDateString(d=new Date()){
 return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function openDB(){
 return new Promise((resolve,reject)=>{
  const r=indexedDB.open(dbName,1);
  r.onupgradeneeded=()=>r.result.createObjectStore(store,{keyPath:'key'});
  r.onsuccess=()=>{db=r.result;resolve(db)};
  r.onerror=()=>reject(r.error);
 });
}

function tx(mode='readonly'){
 return db.transaction(store,mode).objectStore(store);
}

function get(key){
 return new Promise((res,rej)=>{
  const r=tx().get(key);
  r.onsuccess=()=>res(r.result);
  r.onerror=()=>rej(r.error);
 });
}

function all(){
 return new Promise((res,rej)=>{
  const r=tx().getAll();
  r.onsuccess=()=>res(r.result||[]);
  r.onerror=()=>rej(r.error);
 });
}

function put(v){
 return new Promise((res,rej)=>{
  const r=tx('readwrite').put(v);
  r.onsuccess=()=>res();
  r.onerror=()=>rej(r.error);
 });
}

function emptyOrder(){
 return {zn:'',weight:'',points:'',type:'Обычная'};
}

function emptyMissed(){
 return {number:'',category:'Возврат',reason:''};
}


function findDuplicateOrderNumber(value,exceptIndex=-1){
 const normalized=String(value||'').trim().toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g,'');
 if(!normalized)return -1;
 return orders.findIndex((order,index)=>index!==exceptIndex&&String(order.zn||'').trim().toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g,'')===normalized);
}
function warnDuplicateOrder(value,index){
 const duplicateIndex=findDuplicateOrderNumber(value,index);
 if(duplicateIndex<0)return false;
 $('scannerMessage').textContent='Этот ЗН уже добавлен в заказ №'+(duplicateIndex+1)+'. Повторно добавить его нельзя.';
 if(!scannerDuplicateWarned){
  scannerDuplicateWarned=true;
  alert('Дубликат ЗН: '+value+' уже есть в заказе №'+(duplicateIndex+1)+' за этот рабочий день.');
 }
 return true;
}

function stopOrderScanner(){
 try{scannerControls?.stop();}catch(e){}
 scannerControls=null;
 try{scannerReader?.reset();}catch(e){}
 scannerReader=null;
 const video=$('scannerVideo');
 if(video?.srcObject){
  video.srcObject.getTracks().forEach(track=>track.stop());
  video.srcObject=null;
 }
}
async function runOrderOcr(){
 if(ocrBusy)return;
 const video=$('scannerVideo');
 if(!video||!video.videoWidth){$('scannerMessage').textContent='Камера ещё не готова. Подожди секунду и нажми снова.';return;}
 if(!window.Tesseract?.recognize){$('scannerMessage').textContent='Модуль распознавания текста не загрузился. Проверь интернет и обнови страницу.';return;}
 ocrBusy=true;
 $('scannerMessage').textContent='Распознаём текст… Наведи рамку на напечатанный номер рядом с надписью «ЗАКАЗ-НАРЯД №».';
 try{
  const canvas=document.createElement('canvas'),scale=Math.min(1,1600/video.videoWidth);
  canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
  canvas.getContext('2d',{willReadFrequently:true}).drawImage(video,0,0,canvas.width,canvas.height);
  const result=await window.Tesseract.recognize(canvas,'eng',{logger:m=>{
   if(m.status==='recognizing text')$('scannerMessage').textContent='Распознавание текста: '+Math.round((m.progress||0)*100)+'%';
  }});
  const found=[...String(result.data?.text||'').matchAll(/\b\d{7}\b/g)].map(m=>m[0]);
  if(!found.length){$('scannerMessage').textContent='Семизначный номер не найден. Наведи камеру ближе на номер рядом с «ЗАКАЗ-НАРЯД №» и попробуй ещё раз.';return;}
  const value=found[0];
  if(warnDuplicateOrder(value,scanTargetIndex))return;
  if(!orders[scanTargetIndex])orders[scanTargetIndex]=emptyOrder();
  orders[scanTargetIndex].zn=value;renderRows();renderCalc();
  $('message').textContent='Номер ЗН распознан по тексту: '+value+'. Не забудь сохранить рабочий день.';
  closeOrderScanner();
 }catch(err){$('scannerMessage').textContent='Ошибка распознавания: '+(err.message||err);}
 finally{ocrBusy=false;}
}
function closeOrderScanner(){
 stopOrderScanner();
 $('scannerPanel').hidden=true;
}
async function startOrderScanner(index){
 scanTargetIndex=index;
 scannerDuplicateWarned=false;
 const panel=$('scannerPanel');
 panel.hidden=false;
 $('scannerMessage').textContent='Запрашиваем доступ к камере…';
 panel.scrollIntoView({behavior:'smooth',block:'center'});
 if(!window.ZXingBrowser?.BrowserMultiFormatReader){
  $('scannerMessage').textContent='Модуль сканирования не загрузился. Проверь интернет и обнови страницу.';
  return;
 }
 try{
  stopOrderScanner();
  const ZX=window.ZXingBrowser;
  const hints=new Map();
  if(ZX.DecodeHintType&&ZX.BarcodeFormat){
   hints.set(ZX.DecodeHintType.TRY_HARDER,true);
   hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS,[
    ZX.BarcodeFormat.CODE_128,ZX.BarcodeFormat.CODE_39,ZX.BarcodeFormat.CODE_93,
    ZX.BarcodeFormat.CODABAR,ZX.BarcodeFormat.ITF,ZX.BarcodeFormat.EAN_13,
    ZX.BarcodeFormat.EAN_8,ZX.BarcodeFormat.UPC_A,ZX.BarcodeFormat.UPC_E,
    ZX.BarcodeFormat.QR_CODE
   ].filter(Boolean));
  }
  scannerReader=new ZX.BrowserMultiFormatReader(hints.size?hints:undefined,400);
  $('scannerMessage').textContent='Наведи заднюю камеру на весь штрихкод. Держи телефон ровно и дождись фокусировки.';
  scannerControls=await scannerReader.decodeFromConstraints({video:{
   facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}
  }},$('scannerVideo'),(result,error)=>{
   if(result){
    const value=String(result.getText()||'').trim();
    if(!value)return;
    if(warnDuplicateOrder(value,scanTargetIndex))return;
    if(!orders[scanTargetIndex])orders[scanTargetIndex]=emptyOrder();
    orders[scanTargetIndex].zn=value;
    renderRows();
    renderCalc();
    $('message').textContent='Номер ЗН считан: '+value+'. Не забудь сохранить рабочий день.';
    closeOrderScanner();
   }
  });
 }catch(err){
  $('scannerMessage').textContent=err?.name==='NotAllowedError'
   ?'Нет доступа к камере. Разреши использование камеры для сайта в настройках Safari.'
   :err?.name==='NotFoundError'
    ?'Камера не найдена на устройстве.'
    :'Не удалось запустить камеру: '+(err.message||err);
  stopOrderScanner();
 }
}

function renderRows(){
 $('orders').innerHTML=orders.map((o,i)=>{
  const coefficient=o.type==='ТЭК'?rates.tek:1;
  const orderWeight=(Number(o.weight)||0)*1000*coefficient;
  const orderPoints=(Number(o.points)||0)*coefficient;
  const orderTotal=orderWeight*rates.kg+orderPoints*rates.point;
  return `
   <article class="order-card" data-i="${i}">
    <div class="order-card-head">
     <span class="order-index">${String(i+1).padStart(2,'0')}</span>
     <label class="order-number-field">
      <span class="row-label"><svg class="field-icon"><use href="#i-tag"/></svg>Номер заказа-наряда</span>
      <div class="order-number-input"><input data-kind="order" data-field="zn" data-i="${i}" value="${esc(o.zn)}" placeholder="Например, ЗН-458732"><button type="button" class="scan-inline-btn" data-scan-order="${i}" aria-label="Сканировать штрихкод"><svg><use href="#i-scan"/></svg></button></div>
     </label>
     <button class="remove order-remove" data-remove="order" data-i="${i}" aria-label="Удалить заказ">×</button>
    </div>
    <div class="order-fields">
     <label>
      <span class="row-label"><svg class="field-icon"><use href="#i-weight"/></svg>Вес, т</span>
      <input data-kind="order" data-field="weight" data-i="${i}" type="number" min="0" step="0.001" value="${esc(o.weight)}" placeholder="0,000">
     </label>
     <label>
      <span class="row-label"><svg class="field-icon"><use href="#i-pin"/></svg>Количество точек</span>
      <input data-kind="order" data-field="points" data-i="${i}" type="number" min="0" step="1" value="${esc(o.points)}" placeholder="0">
     </label>
     <label class="order-type-field">
      <span class="row-label"><svg class="field-icon"><use href="#i-package"/></svg>Тип заказа</span>
      <select data-kind="order" data-field="type" data-i="${i}">
       <option ${o.type==='Обычная'?'selected':''}>Обычная</option>
       <option ${o.type==='ТЭК'?'selected':''}>ТЭК</option>
      </select>
     </label>
    </div>
    <div class="order-card-total"><span>Начисление по заказу</span><b>${rub(orderTotal)}</b></div>
   </article>
  `;
 }).join('');

 $('missed').innerHTML=missed.map((m,i)=>`
  <div class="missed-row">
   <label>
    <span class="row-label"><svg class="field-icon danger"><use href="#i-alert"/></svg>№ заявки</span>
    <input data-kind="missed" data-field="number" data-i="${i}" value="${esc(m.number)}">
   </label>
   <label>
    <span class="row-label"><svg class="field-icon"><use href="#i-tag"/></svg>Категория</span>
    <select data-kind="missed" data-field="category" data-i="${i}">
     ${['Возврат','Не едет','Не хватает','Отмена'].map(x=>`<option ${m.category===x?'selected':''}>${x}</option>`).join('')}
    </select>
   </label>
   <label>
    <span class="row-label"><svg class="field-icon"><use href="#i-message"/></svg>Причина / комментарий</span>
    <input data-kind="missed" data-field="reason" data-i="${i}" value="${esc(m.reason)}" placeholder="Комментарий">
   </label>
   <button class="remove" data-remove="missed" data-i="${i}">×</button>
  </div>
 `).join('');
}
async function renderMissedJournal(){
 const records=[];
 const days=await all();
 days.forEach(day=>{
  (day.undelivered||[]).forEach((item,index)=>{
   if(!item.number&&!item.reason)return;
   records.push({date:day.date,driver:day.driver||'',item,index});
  });
 });
 records.sort((a,b)=>b.date.localeCompare(a.date));
 const query=($('missedJournalSearch')?.value||'').trim().toLowerCase();
 const category=$('missedJournalCategory')?.value||'';
 const month=$('missedJournalMonth')?.value||'';
 const filtered=records.filter(r=>{
  const haystack=[r.item.number,r.item.category,r.item.reason,r.driver].join(' ').toLowerCase();
  return (!query||haystack.includes(query))&&(!category||r.item.category===category)&&(!month||r.date.startsWith(month));
 });
 $('missedJournalCount').textContent=String(filtered.length);
 $('missedJournalTotal').textContent='Всего: '+records.length;
 $('missedJournalList').innerHTML=filtered.length?filtered.map(r=>`
  <article class="missed-journal-item">
   <div class="missed-journal-top">
    <b>${esc(r.item.number||'Без номера')}</b>
    <span>${new Date(r.date+'T12:00:00').toLocaleDateString('ru-RU',{day:'2-digit',month:'short',year:'numeric'})}</span>
   </div>
   <div class="missed-journal-meta"><span>${esc(r.item.category||'Причина не указана')}</span>${r.driver?`<span>Водитель: ${esc(r.driver)}</span>`:''}</div>
   ${r.item.reason?`<p>${esc(r.item.reason)}</p>`:''}
   <button type="button" class="secondary missed-journal-open" data-load="${esc(r.date)}">Открыть рабочий день</button>
  </article>
 `).join(''):'<p class="message">Невывыезженных заявок по выбранным условиям нет.</p>';
}

function esc(v){
 return String(v??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  '"':'&quot;',
  "'":'&#39;'
 }[c]));
}

function calc(d){
 if(d.status==='Выходной'){
  return {
   weight:0,points:0,weightPay:0,
   pointsPay:0,overtimePay:0,total:0
  };
 }

 let weight=0,points=0;

 (d.orders||[]).forEach(o=>{
  const k=o.type==='ТЭК'?rates.tek:1;
  weight+=(Number(o.weight)||0)*1000*k;
  points+=(Number(o.points)||0)*k;
 });

 const weightPay=weight*rates.kg;
 const pointsPay=points*rates.point;
 const overtimePay=(Number(d.overtime)||0)*rates.overtime;

 return {
  weight,
  points,
  weightPay,
  pointsPay,
  overtimePay,
  total:weightPay+pointsPay+overtimePay
 };
}

function formData(){
 return {
  month:$('month').value,
  date:$('date').value,
  status:$('status').value,
  driver:$('driver').value,
  pallets:Number($('pallets').value)||0,
  overtime:Number($('overtime').value)||0,
  orders:orders.filter(o=>o.zn||Number(o.weight)||Number(o.points)),
  undelivered:missed.filter(m=>m.number||m.reason),
  updatedAt:new Date().toISOString(),
  synced:false
 };
}

function renderCalc(){
 const d=formData(),c=calc(d);
 document.querySelectorAll('.order-card').forEach(card=>{
  const i=Number(card.dataset.i),o=orders[i];
  if(!o)return;
  const coefficient=o.type==='ТЭК'?rates.tek:1;
  const weight=(Number(o.weight)||0)*1000*coefficient;
  const points=(Number(o.points)||0)*coefficient;
  const total=weight*rates.kg+points*rates.point;
  const value=card.querySelector('.order-card-total b');
  if(value)value.textContent=rub(total);
 });

 $('weightTotal').textContent=(Math.round(c.weight*100)/100).toLocaleString('ru-RU')+' кг';
 $('pointsTotal').textContent=(Math.round(c.points*100)/100).toLocaleString('ru-RU');
 $('weightPay').textContent=rub(c.weightPay);
 $('pointsPay').textContent=rub(c.pointsPay);
 $('dayTotal').textContent=rub(c.total);

 $('monthLabel').textContent=new Date(d.month+'-01T12:00:00').toLocaleDateString('ru-RU',{
  month:'long',
  year:'numeric'
 });
}

async function loadDay(date){
 if(!date)return;

 await pullMonth(date.slice(0,7),true);

 const key=date;
 let d=await get(key);

 $('date').value=date;
 $('month').value=date.slice(0,7);

 if(!d){
  orders=[emptyOrder()];
  missed=[];
  $('status').value='Рабочий';
  $('driver').value='';
  $('pallets').value=0;
  $('overtime').value=0;
 }else{
  // Убираем пустые строки заказов и невывозов.
  orders=(d.orders||[]).filter(o=>
   o.zn||Number(o.weight)||Number(o.points)
  );

  if(!orders.length)orders=[emptyOrder()];

  missed=(d.undelivered||[]).filter(m=>
   m.number||m.reason
  );

  $('status').value=d.status||'Рабочий';
  $('driver').value=d.driver||'';
  $('pallets').value=d.pallets||0;
  $('overtime').value=d.overtime||0;
 }

 renderRows();
 renderCalc();
 await renderMonth();
 await renderMissedJournal();
}

async function renderMonth(){
 const m=$('month').value;
 const days=(await all()).filter(d=>d.month===m);

 let total=rates.salary,pending=0;

 days.forEach(d=>{
  if(d.status!=='Выходной')total+=calc(d).total;
  if(!d.synced)pending++;
 });

 $('monthTotal').textContent=rub(total);
 $('monthNet').textContent=rub(total*(1-rates.taxRate));
 $('pendingCount').textContent=pending+' ожидают';

 $('syncLabel').textContent=pending
  ?'Есть несинхронизированные данные'
  :'Локальные данные сохранены';

 renderCalendar(m);
 renderOrderAnalytics(m);

 $('daysList').innerHTML=
  `<button id="restoreBtn" type="button">Восстановить всю историю из Google</button>`+
  (
   days.sort((a,b)=>a.date.localeCompare(b.date)).map(d=>`
    <div class="day-item">
     <span>${new Date(d.date+'T12:00:00').toLocaleDateString('ru-RU',{
      day:'2-digit',
      month:'long'
     })} · ${esc(d.status||'Рабочий')}</span>
     <span>${rub(calc(d).total)}</span>
     <button data-load="${d.date}">Открыть</button>
     <button class="remove" data-delete="${d.date}" title="Удалить день" aria-label="Удалить день">×</button>
    </div>
   `).join('')||
   '<p class="message">За этот месяц пока нет сохранённых дней.</p>'
  );
}


function monthDaysInCalendar(monthKey){
 const [year,month]=monthKey.split('-').map(Number);
 return new Date(year,month,0).getDate();
}

async function renderCalendar(monthKey=$('calendarMonth').value){
 if(!monthKey)return;
 const days=(await all()).filter(d=>d.month===monthKey);
 const byDate=new Map(days.map(d=>[d.date,d]));
 const [year,month]=monthKey.split('-').map(Number);
 const firstDay=(new Date(year,month-1,1).getDay()+6)%7;
 const count=monthDaysInCalendar(monthKey);
 const amounts=days.map(d=>d.status==='Выходной'?0:calc(d).total);
 const max=Math.max(1,...amounts);
 let total=0,workDays=0;
 const cells=[];
 for(let i=0;i<firstDay;i++)cells.push('<span class="calendar-empty"></span>');
 for(let day=1;day<=count;day++){
  const date=monthKey+'-'+String(day).padStart(2,'0');
  const record=byDate.get(date);
  const amount=record&&record.status!=='Выходной'?calc(record).total:0;
  if(record&&record.status!=='Выходной'){total+=amount;workDays++;}
  const level=amount<=0?0:Math.min(4,Math.max(1,Math.ceil(amount/max*4)));
  const selected=$('calendarSelectedDate').value===date?' selected':'';
  const label=record?rub(amount):'Нет записи';
  cells.push(`<button type="button" class="calendar-day level-${level}${selected}" data-calendar-date="${date}" aria-label="${date}: ${esc(label)}"><span>${day}</span>${record&&amount>0?`<small>${Math.round(amount/100)/10}к</small>`:''}</button>`);
 }
 $('earningsCalendar').innerHTML=cells.join('');
 $('calendarWorkDays').textContent=String(workDays);
 $('calendarTotal').textContent=rub(total);
 const detailDate=$('calendarSelectedDate')?.value||'';
 if(detailDate&&byDate.has(detailDate))showCalendarDetail(byDate.get(detailDate));
}

function showCalendarDetail(day){
 const c=calc(day);
 const orders=(day.orders||[]).filter(o=>o.zn||Number(o.weight)||Number(o.points));
 $('calendarDayDetail').innerHTML=`
  <div class="detail-head"><b>${new Date(day.date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})}</b><strong>${day.status==='Выходной'?'Выходной':rub(c.total)}</strong></div>
  <div class="detail-grid">
   <span>Заказов ЗН <b>${orders.length}</b></span>
   <span>Вес <b>${(c.weight/1000).toLocaleString('ru-RU',{maximumFractionDigits:2})} т</b></span>
   <span>Точки <b>${c.points.toLocaleString('ru-RU')}</b></span>
   <span>Переработка <b>${Number(day.overtime)||0} ч</b></span>
  </div>
  <button type="button" class="secondary detail-open" data-load="${day.date}">Открыть рабочий день</button>`;
}

async function renderOrderAnalytics(monthKey=$('month').value){
 const days=(await all()).filter(d=>d.month===monthKey);
 let count=0,weight=0,points=0,missed=0,overtime=0;
 let workDays=0,bestDay=null;
 for(const d of days){
  if(d.status==='Выходной')continue;
  workDays++;
  const orders=(d.orders||[]).filter(o=>o.zn||Number(o.weight)||Number(o.points));
  count+=orders.length;
  if(!bestDay||orders.length>bestDay.count){
   bestDay={date:d.date,count:orders.length};
  }
  const c=calc(d);
  weight+=c.weight;
  points+=c.points;
  missed+=(d.undelivered||[]).filter(m=>m.number||m.reason).length;
  overtime+=Number(d.overtime)||0;
 }
 $('analyticsOrders').textContent=String(count);
 $('analyticsWeight').textContent=(weight/1000).toLocaleString('ru-RU',{maximumFractionDigits:2})+' т';
 $('analyticsPoints').textContent=points.toLocaleString('ru-RU',{maximumFractionDigits:1});
 $('analyticsAverage').textContent=count?(weight/count).toLocaleString('ru-RU',{maximumFractionDigits:0})+' кг':'0 кг';
 $('analyticsMissed').textContent=String(missed);
 $('analyticsOvertime').textContent=(Math.round(overtime*10)/10).toLocaleString('ru-RU')+' ч';
 $('analyticsDailyAverage').textContent=workDays?(count/workDays).toLocaleString('ru-RU',{maximumFractionDigits:1}):'0';
 $('analyticsBestDay').textContent=bestDay&&bestDay.count
  ?bestDay.count+' · '+new Date(bestDay.date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'})
  :'—';
 $('analyticsNote').textContent=days.length
  ?`Учтено ${days.length} сохранённых дней за ${new Date(monthKey+'-01T12:00:00').toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}. Среднее рассчитано по рабочим дням; лучший день — по количеству заказов ЗН.`
  :'За выбранный месяц пока нет сохранённых дней.';
}

async function save(){
 const d=formData();

 if(!d.date){
  $('message').textContent='Выбери дату.';
  return;
 }

 d.key=d.date;
 await put(d);

 $('message').textContent='Сохранено на этом iPhone · '+new Date().toLocaleTimeString('ru-RU',{
  hour:'2-digit',
  minute:'2-digit'
 });

 await renderMonth();
 renderCalc();
 await renderStats();
 await renderMissedJournal();

 if(navigator.onLine)await sync();
}

async function api(action,payload={}){
 const cfg=window.APP_CONFIG||{};
 const apiUrl=cfg.API_URL||APP_SCRIPT_API_URL;
 const token=localStorage.getItem('MZ_API_TOKEN')||'';

 if(!apiUrl||!token){
  throw new Error('Укажите URL Apps Script в config.js и сохраните токен в настройках приложения');
 }

 const outgoing={...payload};

 if(action==='saveDay'&&outgoing.day){
  const d=outgoing.day;

  outgoing.day={
   ...d,
   overtimeHours:d.overtime,
   orders:(d.orders||[]).map(o=>({
    number:o.zn,
    weightTonnes:o.weight,
    points:o.points,
    type:o.type
   })),
   undelivered:(d.undelivered||[]).map(m=>({
    number:m.number,
    category:m.category,
    reason:m.reason
   }))
  };
 }

 const response=await fetch(apiUrl,{
  method:'POST',
  headers:{'Content-Type':'text/plain;charset=utf-8'},
  body:JSON.stringify({token:token,action,...outgoing})
 });

 const result=await response.json();

 if(!result.ok)throw new Error(result.error||'Ошибка API');

 return result;
}

async function loadRatesFromSheet(){
 if(!navigator.onLine)throw new Error('Нет интернета для загрузки настроек.');
 const cfg=window.APP_CONFIG||{};
 const apiUrl=cfg.API_URL||APP_SCRIPT_API_URL;
 if(!apiUrl)throw new Error('Не загружен URL Apps Script из config.js.');
 if(!localStorage.getItem('MZ_API_TOKEN'))throw new Error('Не сохранён API_TOKEN на этом устройстве.');
 const result=await api('getSettings');
 const incoming=result.settings||{};
 ['salary','kg','point','tek','overtime','taxRate'].forEach(key=>{
  const value=Number(incoming[key]);
  if(Number.isFinite(value)&&value>=0)rates[key]=value;
 });
 return true;
}

// Загружает дни выбранного месяца из Google Таблиц в локальную базу.
async function pullMonth(month,quiet=false){
 if(!navigator.onLine)return {loaded:0};

 const cfg=window.APP_CONFIG||{};
 const apiUrl=cfg.API_URL||APP_SCRIPT_API_URL;

 if(!apiUrl||!localStorage.getItem('MZ_API_TOKEN')){
  return {loaded:0};
 }

 try{
  const result=await api('getMonthDays',{month});
  const cloudDays=result.days||[];

  const localDays=(await all()).filter(d=>d.month===month);
  const localByDate=new Map(localDays.map(d=>[d.date,d]));

  let loaded=0;

  for(const cloudDay of cloudDays){
   const local=localByDate.get(cloudDay.date);

   // Несинхронизированные изменения на iPhone не затираем облачной копией.
   if(local&&!local.synced)continue;

   const day={
    ...cloudDay,

    // Убираем пустые строки, полученные из Google Таблиц.
    orders:(cloudDay.orders||[]).filter(o=>
     o.zn||Number(o.weight)||Number(o.points)
    ),

    undelivered:(cloudDay.undelivered||[]).filter(m=>
     m.number||m.reason
    ),

    key:cloudDay.date,
    month:month,
    synced:true,
    syncedAt:local?.syncedAt||new Date().toISOString()
   };

   await put(day);
   loaded++;
  }

  if(!quiet){
   $('message').textContent=loaded
    ?`Загружено из Google Таблиц дней: ${loaded}`
    :'Облачная история проверена — новых дней нет';
  }

  return {loaded,found:cloudDays.length};

 }catch(e){
  if(!quiet){
   $('message').textContent='Не удалось загрузить историю из Google Таблиц: '+e.message;
  }

  return {loaded:0,found:0,error:e};
 }
}

// Восстановление всей истории из всех месячных таблиц Google.
async function restoreAll(){
 if(!navigator.onLine){
  $('message').textContent='Для восстановления нужен интернет.';
  return;
 }

 $('message').textContent='Получаем список месяцев из Google Таблиц…';

 try{
  const list=await api('listMonths');

  const months=(list.months||[])
   .map(x=>x.month)
   .filter(Boolean);

  if(!months.length){
   $('message').textContent='В Google Таблицах пока нет сохранённых месяцев.';
   return;
  }

  let loaded=0;
  let found=0;
  const errors=[];

  for(const month of months){
   const result=await pullMonth(month,true);
   if(result.error){
    errors.push(month+': '+result.error.message);
    continue;
   }
   loaded+=result.loaded||0;
   found+=result.found||0;
  }

  if(errors.length){
   $('message').textContent='История восстановлена не полностью. Успешно проверено месяцев: '+
    (months.length-errors.length)+' из '+months.length+'. Ошибки: '+errors.join('; ');
   return;
  }

  const selectedDate=$('date').value||localDateString();
  await loadDay(selectedDate);

  $('message').textContent=
   `Проверка завершена. Дней найдено в Google: ${found}; добавлено на устройство: ${loaded}; месяцев: ${months.length}.`;
  await renderStats();

 }catch(e){
  $('message').textContent='Не удалось восстановить историю: '+e.message;
 }
}

async function sync(){
 if(!navigator.onLine){
  $('message').textContent='Нет интернета. Данные останутся на iPhone.';
  return;
 }

 try{
  await loadRatesFromSheet();
  fillSettingsInputs();
  await renderMonth();
  await renderStats();
  $('message').textContent='Настройки загружены. Синхронизация…';

  const days=(await all()).filter(d=>!d.synced);

  for(const d of days){
   const result=await api('saveDay',{day:d});

   d.synced=true;
   d.spreadsheetId=result.spreadsheetId||d.spreadsheetId;
   d.syncedAt=new Date().toISOString();

   await put(d);
  }

  $('message').textContent=days.length
   ?`Синхронизировано дней: ${days.length}`
   :'Все дни уже синхронизированы';

 }catch(e){
  $('message').textContent='Ошибка подключения: '+e.message;
 }

 await renderMonth();
 await renderStats();
}


function monthKeyFromDate(date){
 return String(date||'').slice(0,7);
}

function statsPeriodValue(){
 const period=$('statsPeriod').value;
 return period==='year'?String($('statsYear').value||today.getFullYear()):$('statsMonth').value;
}

async function renderStats(){
 const period=$('statsPeriod').value;
 const selected=statsPeriodValue();
 const allDays=await all();
 let selectedDays=[];

 if(period==='year'){
  selectedDays=allDays.filter(d=>String(d.date||'').startsWith(selected+'-'));
  if($('statsPeriodLabel')) $('statsPeriodLabel').textContent='За '+selected+' год';
 }else{
  selectedDays=allDays.filter(d=>monthKeyFromDate(d.date)===selected);
  if($('statsPeriodLabel')) $('statsPeriodLabel').textContent='За '+(selected?new Date(selected+'-01T12:00:00').toLocaleDateString('ru-RU',{month:'long',year:'numeric'}):'месяц');
 }

 selectedDays.sort((a,b)=>a.date.localeCompare(b.date));
 const workDays=selectedDays.filter(d=>d.status!=='Выходной');
 let variable=0,weightPay=0,pointsPay=0,overtimePay=0,overtimeHours=0,ordersCount=0,weightKg=0,points=0,missedCount=0;
 const daily=selectedDays.map(d=>{
  const c=calc(d);
  if(d.status!=='Выходной'){
   variable+=c.total;
   weightPay+=c.weightPay;
   pointsPay+=c.pointsPay;
   overtimePay+=c.overtimePay;
   weightKg+=c.weight;
   points+=c.points;
  }
  overtimeHours+=Number(d.overtime)||0;
  ordersCount+=(d.orders||[]).filter(o=>o.zn||Number(o.weight)||Number(o.points)).length;
  missedCount+=(d.undelivered||[]).filter(m=>m.number||m.reason).length;
  return {date:d.date,amount:c.total};
 });

 const monthsWithRecords=new Set(selectedDays.map(d=>monthKeyFromDate(d.date)));
 const salary=period==='year'?rates.salary*monthsWithRecords.size:(selectedDays.length?rates.salary:0);
 const total=salary+variable;
 const tax=Math.round(total*rates.taxRate*100)/100;
 const net=total-tax;

 $('statTotal').textContent=rub(total);
 $('statTax').textContent=rub(tax);
 $('statNet').textContent=rub(net);
 $('statWorkDays').textContent=String(workDays.length);
 $('statOrders').textContent=String(ordersCount);
 $('statOvertime').textContent=(Math.round(overtimeHours*10)/10).toLocaleString('ru-RU')+' ч';
 $('statSalary').textContent=rub(salary);
 $('statWeightPay').textContent=rub(weightPay);
 $('statPointsPay').textContent=rub(pointsPay);
 $('statOvertimePay').textContent=rub(overtimePay);

 const chartDays=daily.filter(x=>x.amount>0).slice(-12);
 const max=Math.max(1,...chartDays.map(x=>x.amount));
 $('statsChart').innerHTML=chartDays.length?chartDays.map(x=>{
  const day=x.date.slice(-2);
  const width=Math.max(2,Math.round(x.amount/max*100));
  return `<div class="stats-bar-row"><span>${day}</span><div class="stats-bar-track"><div class="stats-bar-fill" style="width:${width}%"></div></div><b class="stats-bar-value">${rub(x.amount)}</b></div>`;
 }).join(''):'<p class="message">Нет начислений за выбранный период.</p>';

 // Forecast for the current month: fixed salary + average variable earnings
 // per saved working day, projected across weekdays (Mon-Fri) in the month.
 let forecastText='Недоступен для выбранного периода';
 let forecastNote='Выбери текущий месяц для расчёта прогноза.';
 if(period==='month'&&selected===monthNow){
  const now=new Date();
  const year=now.getFullYear();
  const month=now.getMonth();
  const daysInMonth=new Date(year,month+1,0).getDate();
  let weekdaysInMonth=0;
  for(let day=1;day<=daysInMonth;day++){
   const weekday=new Date(year,month,day).getDay();
   if(weekday!==0&&weekday!==6) weekdaysInMonth++;
  }
  const savedWorkDays=workDays.length;
  if(savedWorkDays>0){
   const averageVariablePerDay=variable/savedWorkDays;
   const projectedVariable=averageVariablePerDay*weekdaysInMonth;
   const projected=Math.round(rates.salary+projectedVariable);
   forecastText=rub(projected);
   forecastNote=`Оценка: оклад ${rub(rates.salary)} + средний переменный заработок за ${savedWorkDays} сохранённых рабочих дня, рассчитанный на ${weekdaysInMonth} будних дней месяца (график 5/2). Не является гарантированной суммой.`;
  }else{
   forecastText='Пока недостаточно данных';
   forecastNote='Сохрани хотя бы один рабочий день, чтобы рассчитать прогноз.';
  }
 }
 $('statForecast').textContent=forecastText;
 $('statForecastNote').textContent=forecastNote;

 // Compare selected month with previous month when both are month views.
 if(period==='month'&&selected){
  const d=new Date(selected+'-01T12:00:00');
  d.setMonth(d.getMonth()-1);
  const previousKey=`${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  const previousDays=allDays.filter(x=>monthKeyFromDate(x.date)===previousKey);
  if(previousDays.length){
   const previousTotal=rates.salary+previousDays.reduce((s,x)=>s+(x.status==='Выходной'?0:calc(x).total),0);
   const diff=total-previousTotal;
   const sign=diff>0?'+':'';
   $('statsCompare').textContent=`По сравнению с ${d.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}: ${sign}${rub(diff)} (предыдущий месяц: ${rub(previousTotal)}).`;
  }else{
   $('statsCompare').textContent='Для сравнения с предыдущим месяцем пока недостаточно сохранённых данных.';
  }
 }else{
  $('statsCompare').textContent=`Дополнительно: оплачиваемый вес ${Math.round(weightKg*100)/100} кг · точки ${Math.round(points*100)/100} · невывозы ${missedCount}.`;
 }
 $('statsMessage').textContent=`Учтено дней: ${selectedDays.length}. В годовом режиме оклад учитывается только за месяцы, в которых есть сохранённые дни.`;
}

async function exportStatsCSV(){
 const period=$('statsPeriod').value;
 const selected=statsPeriodValue();
 const days=(await all()).filter(d=>period==='year'
  ?String(d.date||'').startsWith(selected+'-')
  :monthKeyFromDate(d.date)===selected
 ).sort((a,b)=>a.date.localeCompare(b.date));

 const rows=[['Дата','Статус','Водитель','Поддоны','Заказов ЗН','Вес, кг','Точки','Переработка, ч','Начислено за день, руб']];
 for(const d of days){
  const c=calc(d);
  const orders=(d.orders||[]).filter(o=>o.zn||Number(o.weight)||Number(o.points));
  rows.push([
   d.date,d.status||'Рабочий',d.driver||'',d.pallets||0,orders.length,
   Math.round(c.weight*100)/100,Math.round(c.points*100)/100,
   Number(d.overtime)||0,Math.round(c.total*100)/100
  ]);
 }
 const csv='\\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\\r\\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 a.href=url;
 a.download=`zarplata-${selected}.csv`;
 document.body.appendChild(a);
 a.click();
 a.remove();
 URL.revokeObjectURL(url);
 $('statsMessage').textContent='Файл CSV подготовлен для открытия в Excel.';
}

function buildReport(){
 const month=$('month').value||monthNow;

 all().then(days=>{
  const selected=days
   .filter(d=>d.month===month)
   .sort((a,b)=>a.date.localeCompare(b.date));

  let total=0,workDays=0,orderCount=0,overtime=0,missedCount=0;

  const rows=selected.map(d=>{
   const c=calc(d);

   if(d.status!=='Выходной'){
    total+=c.total;
    workDays++;
   }

   orderCount+=(d.orders||[]).filter(o=>
    o.zn||Number(o.weight)||Number(o.points)
   ).length;

   overtime+=Number(d.overtime)||0;

   missedCount+=(d.undelivered||[]).filter(m=>
    m.number||m.reason
   ).length;

   return `<tr>
    <td>${esc(d.date)}</td>
    <td>${esc(d.status||'Рабочий')}</td>
    <td>${esc(d.driver||'')}</td>
    <td>${(d.orders||[]).filter(o=>o.zn||Number(o.weight)||Number(o.points)).length}</td>
    <td>${rub(c.total)}</td>
   </tr>`;
  }).join('');

  $('printReport').innerHTML=`
   <div class="print-head">
    <h1>Моя зарплата — отчёт за ${esc(month)}</h1>
    <p>Сформировано: ${new Date().toLocaleString('ru-RU')}</p>
   </div>

   <div class="print-stats">
    <div>Оклад: <b>${rub(rates.salary)}</b></div>
    <div>Рабочих дней: <b>${workDays}</b></div>
    <div>ЗН: <b>${orderCount}</b></div>
    <div>Переработка: <b>${overtime} ч</b></div>
    <div>Невывозы: <b>${missedCount}</b></div>
    <div>Итого с окладом: <b>${rub(rates.salary+total)}</b></div>
   </div>

   <table>
    <thead>
     <tr>
      <th>Дата</th>
      <th>Статус</th>
      <th>Водитель</th>
      <th>ЗН</th>
      <th>Начислено за день</th>
     </tr>
    </thead>
    <tbody>
     ${rows||'<tr><td colspan="5">За выбранный месяц нет сохранённых дней</td></tr>'}
    </tbody>
   </table>

   <p class="print-note">
    Невывозы учитываются отдельно и не уменьшают зарплату автоматически.
    Расчёт предварительный по данным, сохранённым в приложении.
   </p>
  `;

  $('printReport').classList.add('ready');
  window.print();
 });
}

['missedJournalSearch','missedJournalCategory','missedJournalMonth'].forEach(id=>{
 const el=$(id);
 if(!el)return;
 el.addEventListener(id==='missedJournalSearch'?'input':'change',renderMissedJournal);
});

document.addEventListener('input',e=>{
 const el=e.target;

 if(el.dataset.kind){
  const arr=el.dataset.kind==='order'?orders:missed;
  arr[Number(el.dataset.i)][el.dataset.field]=el.value;
  renderCalc();

 }else if(['driver','pallets','overtime','status'].includes(el.id)){
  renderCalc();
 }
});

document.addEventListener('change',e=>{
 const el=e.target;

 if(el.dataset.kind){
  const arr=el.dataset.kind==='order'?orders:missed;
  arr[Number(el.dataset.i)][el.dataset.field]=el.value;
  renderCalc();
 }
});

document.addEventListener('click',async e=>{
 const el=e.target.closest('button');

 if(!el)return;


 if(el.id==='calendarPrev'||el.id==='calendarNext'){
  const input=$('calendarMonth');
  const [y,m]=input.value.split('-').map(Number);
  const shift=el.id==='calendarPrev'?-1:1;
  const next=new Date(y,m-1+shift,1);
  input.value=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0');
  $('calendarSelectedDate').value='';
  await renderCalendar(input.value);
  $('calendarDayDetail').textContent='Выбери дату, чтобы посмотреть подробности.';
 }
 if(el.dataset.calendarDate){
  const date=el.dataset.calendarDate;
  const record=await get(date);
  const detail=$('calendarDayDetail');
  $('calendarSelectedDate').value=date;
  if(record){
   showCalendarDetail(record);
  }else{
   detail.innerHTML=`<div class="detail-head"><b>${new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}</b><span>Записи нет</span></div><button type="button" class="secondary detail-open" data-new-date="${date}">Добавить рабочий день</button>`;
  }
  await renderCalendar($('calendarMonth').value);
 }
 if(el.dataset.newDate){
  await loadDay(el.dataset.newDate);
  document.getElementById('workDaySection').scrollIntoView({behavior:'smooth',block:'start'});
 }
 if(el.id==='openMissedJournal'){
  await renderMissedJournal();
  $('missedJournalSection').scrollIntoView({behavior:'smooth',block:'start'});
 }
 if(el.dataset.nav){
  document.getElementById(el.dataset.nav)?.scrollIntoView({behavior:'smooth',block:'start'});
  document.querySelectorAll('.nav-item').forEach(btn=>btn.classList.toggle('active',btn===el));
 }
 if(el.id==='scanNewOrder'){
  let index=orders.findIndex(o=>!String(o.zn||'').trim());
  if(index<0&&orders.length<20){orders.push(emptyOrder());index=orders.length-1;renderRows();}
  if(index<0){$('message').textContent='Достигнут лимит в 20 заказов за день.';return;}
  await startOrderScanner(index);
 }
 if(el.dataset.scanOrder!==undefined){
  await startOrderScanner(Number(el.dataset.scanOrder));
 }
 if(el.id==='readTextNumber')await runOrderOcr();
 if(el.id==='closeScanner'||el.id==='stopScanner')closeOrderScanner();
 if(el.id==='addOrder'&&orders.length<20){
  orders.push(emptyOrder());
  renderRows();
 }

 if(el.id==='addMissed'&&missed.length<20){
  missed.push(emptyMissed());
  renderRows();
 }

 if(el.dataset.remove){
  const a=el.dataset.remove==='order'?orders:missed;
  a.splice(Number(el.dataset.i),1);
  renderRows();
  renderCalc();
 }

 if(el.id==='saveBtn')await save();

 if(el.id==='syncBtn'||el.id==='settingsSyncBtn')await sync();

 if(el.id==='restoreBtn'||el.id==='settingsRestoreBtn')await restoreAll();

 if(el.dataset.delete){
  const date=el.dataset.delete;

  if(!navigator.onLine){
   $('message').textContent='Для удаления дня сначала подключись к интернету.';
   return;
  }

  if(!confirm('Удалить запись за '+date+' и из Google Таблиц? Это действие нельзя отменить.')){
   return;
  }

  try{
   await api('deleteDay',{
    month:date.slice(0,7),
    date
   });

   const request=tx('readwrite').delete(date);

   await new Promise((resolve,reject)=>{
    request.onsuccess=resolve;
    request.onerror=()=>reject(request.error);
   });

   $('message').textContent='Запись за '+date+' удалена из приложения и Google Таблиц.';

   if($('date').value===date){
    await loadDay(localDateString());
   }else{
    await renderMonth();
   }
   await renderStats();

  }catch(err){
   $('message').textContent='Не удалось удалить запись: '+err.message;
  }
 }

 if(el.id==='printBtn')buildReport();

 if(el.id==='saveRatesBtn')await saveRateSettings();
 if(el.id==='exportStatsSettingsBtn')exportStatsCSV();

 if(el.id==='tokenSave'){
  const t=$('apiToken').value.trim();

  if(t){
   localStorage.setItem('MZ_API_TOKEN',t);
   $('apiToken').value='';
   $('message').textContent='Токен сохранён. Загружаем настройки…';
   try{
    await loadRatesFromSheet();
    await renderMonth();
    await renderStats();
    $('message').textContent='Токен сохранён. Настройки Google Таблицы загружены.';
    fillSettingsInputs();
    $('settingsMessage').textContent='Настройки загружены из Google Таблицы.';
   }catch(err){
    $('message').textContent='Токен сохранён, но настройки не загрузились: '+err.message;
   }
  }else{
   $('message').textContent='Вставь токен перед сохранением.';
  }
 }

 if(el.id==='tokenClear'){
  localStorage.removeItem('MZ_API_TOKEN');
  $('apiToken').value='';
  $('message').textContent='Локальный токен удалён.';
 }

 if(el.id==='todayBtn'){
  await loadDay(localDateString());
 }

 if(el.dataset.load){
  await loadDay(el.dataset.load);
 }
});

$('date').addEventListener('change',async e=>{
 await loadDay(e.target.value);
 $('calendarMonth').value=e.target.value.slice(0,7);
 $('calendarSelectedDate').value=e.target.value;
 await renderCalendar($('calendarMonth').value);
});

$('month').addEventListener('change',async e=>{
 const d=e.target.value+'-01';
 await loadDay(d);
 $('calendarMonth').value=e.target.value;
 await renderCalendar(e.target.value);
});

$('status').addEventListener('change',renderCalc);
$('driver').addEventListener('input',renderCalc);
$('pallets').addEventListener('input',renderCalc);
$('overtime').addEventListener('input',renderCalc);


$('statsPeriod').addEventListener('change',async()=>{
 const yearMode=$('statsPeriod').value==='year';
 $('statsMonth').hidden=yearMode;
 $('statsYear').hidden=!yearMode;
 await renderStats();
});
$('statsMonth').addEventListener('change',async()=>{
 await renderStats();
 $('calendarMonth').value=$('statsMonth').value;
 await renderCalendar($('calendarMonth').value);
 await renderOrderAnalytics($('statsMonth').value);
});
$('statsYear').addEventListener('change',renderStats);
$('exportStatsBtn').addEventListener('click',exportStatsCSV);
$('calendarMonth').addEventListener('change',e=>renderCalendar(e.target.value));

window.addEventListener('online',()=>{
 $('net').textContent='Интернет есть';
 $('net').className='pill green';
 sync();
});

window.addEventListener('offline',()=>{
 $('net').textContent='Без интернета';
 $('net').className='pill';
});

(async()=>{
 try{
  await openDB();

  if('serviceWorker'in navigator){
   navigator.serviceWorker.register('./sw.js?v=22',{updateViaCache:'none'}).then(reg=>reg.update()).catch(err=>console.warn('Service worker update failed:',err));
  }

  $('net').textContent=navigator.onLine?'Интернет есть':'Без интернета';
  $('net').className=navigator.onLine?'pill green':'pill';

  try{
   await loadRatesFromSheet();
  }catch(settingsError){
   $('message').textContent='Не удалось загрузить ставки из Google Таблицы. Используются значения по умолчанию: '+settingsError.message;
  }

  await loadDay(localDateString());
  await renderMissedJournal();
  $('calendarMonth').value=monthNow;
  $('calendarSelectedDate').value='';
  $('statsMonth').value=monthNow;
  $('statsYear').value=today.getFullYear();
  await renderStats();

 }catch(e){
  $('message').textContent='Ошибка локального хранилища: '+e.message;
 }
})();

})();
