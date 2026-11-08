(() => {
const $=id=>document.getElementById(id), dbName='MoyaZarplataDB', store='days';
let db, orders=[], missed=[], currentMonth='';
const rates={salary:43400,kg:0.87,point:22.20,tek:0.5,overtime:500};
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

function renderRows(){
 $('orders').innerHTML=orders.map((o,i)=>`
  <div class="order-row" data-i="${i}">
   <label>
    <span class="row-label">№ ЗН</span>
    <input data-kind="order" data-field="zn" data-i="${i}" value="${esc(o.zn)}" placeholder="Номер">
   </label>
   <label>
    <span class="row-label">Вес, т</span>
    <input data-kind="order" data-field="weight" data-i="${i}" type="number" step="0.001" value="${esc(o.weight)}" placeholder="0">
   </label>
   <label>
    <span class="row-label">Точки</span>
    <input data-kind="order" data-field="points" data-i="${i}" type="number" step="1" value="${esc(o.points)}" placeholder="0">
   </label>
   <label>
    <span class="row-label">Тип</span>
    <select data-kind="order" data-field="type" data-i="${i}">
     <option ${o.type==='Обычная'?'selected':''}>Обычная</option>
     <option ${o.type==='ТЭК'?'selected':''}>ТЭК</option>
    </select>
   </label>
   <button class="remove" data-remove="order" data-i="${i}" aria-label="Удалить">×</button>
  </div>
 `).join('');

 $('missed').innerHTML=missed.map((m,i)=>`
  <div class="missed-row">
   <label>
    <span class="row-label">№ заявки</span>
    <input data-kind="missed" data-field="number" data-i="${i}" value="${esc(m.number)}">
   </label>
   <label>
    <span class="row-label">Категория</span>
    <select data-kind="missed" data-field="category" data-i="${i}">
     ${['Возврат','Не едет','Не хватает','Отмена'].map(x=>`<option ${m.category===x?'selected':''}>${x}</option>`).join('')}
    </select>
   </label>
   <label>
    <span class="row-label">Причина / комментарий</span>
    <input data-kind="missed" data-field="reason" data-i="${i}" value="${esc(m.reason)}" placeholder="Комментарий">
   </label>
   <button class="remove" data-remove="missed" data-i="${i}">×</button>
  </div>
 `).join('');
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
 $('pendingCount').textContent=pending+' ожидают';

 $('syncLabel').textContent=pending
  ?'Есть несинхронизированные данные'
  :'Локальные данные сохранены';

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

 if(navigator.onLine)await sync();
}

async function api(action,payload={}){
 const cfg=window.APP_CONFIG||{};
 const token=localStorage.getItem('MZ_API_TOKEN')||'';

 if(!cfg.API_URL||!token){
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

 const response=await fetch(cfg.API_URL,{
  method:'POST',
  headers:{'Content-Type':'text/plain;charset=utf-8'},
  body:JSON.stringify({token:token,action,...outgoing})
 });

 const result=await response.json();

 if(!result.ok)throw new Error(result.error||'Ошибка API');

 return result;
}

// Загружает дни выбранного месяца из Google Таблиц в локальную базу.
async function pullMonth(month,quiet=false){
 if(!navigator.onLine)return {loaded:0};

 const cfg=window.APP_CONFIG||{};

 if(!cfg.API_URL||!localStorage.getItem('MZ_API_TOKEN')){
  return {loaded:0};
 }

 try{
  const result=await api('getMonthDays',{month});

  const localDays=(await all()).filter(d=>d.month===month);
  const localByDate=new Map(localDays.map(d=>[d.date,d]));

  let loaded=0;

  for(const cloudDay of (result.days||[])){
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

  return {loaded};

 }catch(e){
  if(!quiet){
   $('message').textContent='Не удалось загрузить историю из Google Таблиц: '+e.message;
  }

  return {loaded:0,error:e};
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

  let loaded=0;

  for(const month of months){
   const result=await pullMonth(month,true);
   loaded+=result.loaded||0;
  }

  const selectedDate=$('date').value||localDateString();

  await loadDay(selectedDate);

  $('message').textContent=
   `Восстановление завершено. Обновлено дней: ${loaded}. Месяцев в облаке: ${months.length}.`;
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

 const cfg=window.APP_CONFIG||{};

 if(!cfg.API_URL||!localStorage.getItem('MZ_API_TOKEN')){
  $('message').textContent='Локально сохранено. Настройте URL и токен для синхронизации.';
  return;
 }

 $('message').textContent='Синхронизация…';

 try{
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
  $('message').textContent='Не удалось синхронизировать: '+e.message;
 }

 await renderMonth();
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

 $('statTotal').textContent=rub(total);
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

 if(el.id==='syncBtn')await sync();

 if(el.id==='restoreBtn')await restoreAll();

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

 if(el.id==='tokenSave'){
  const t=$('apiToken').value.trim();

  if(t){
   localStorage.setItem('MZ_API_TOKEN',t);
   $('apiToken').value='';
   $('message').textContent='Токен сохранён локально на этом устройстве.';
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

$('date').addEventListener('change',e=>loadDay(e.target.value));

$('month').addEventListener('change',async e=>{
 const d=e.target.value+'-01';
 await loadDay(d);
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
$('statsMonth').addEventListener('change',renderStats);
$('statsYear').addEventListener('change',renderStats);
$('exportStatsBtn').addEventListener('click',exportStatsCSV);

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
   navigator.serviceWorker.register('./sw.js');
  }

  $('net').textContent=navigator.onLine?'Интернет есть':'Без интернета';
  $('net').className=navigator.onLine?'pill green':'pill';

  await loadDay(localDateString());
  $('statsMonth').value=monthNow;
  $('statsYear').value=today.getFullYear();
  await renderStats();

 }catch(e){
  $('message').textContent='Ошибка локального хранилища: '+e.message;
 }
})();

})();
