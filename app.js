/* Контроллер: загрузка шаблонов (сеть / папка / кэш), список, перетаскивание,
   карточка, управление, выгрузка, клавиатура, темы, мобильные вкладки. */
(function(){
"use strict";

const M = window.Model, V = window.View, C = window.CSV;
const $ = id => document.getElementById(id);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ROW_H = 54;
const IS_FILE = location.protocol === 'file:';

let vlist = [], drag = null, pan = null, lastDragEnd = 0, drawerPid = null, rafId = null;
let assetSource = '—', lastDemoNames = null;

/* ---------- тосты ---------- */
function toast(kind, msg, action){
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  const icons = {ok:'✓', warn:'!', err:'×', info:'i'};
  el.innerHTML = '<span class="ic">' + (icons[kind]||'i') + '</span><span class="msg">' + esc(msg) + '</span>';
  const t = setTimeout(remove, action ? 7000 : 3600);
  function remove(){ clearTimeout(t); el.classList.add('out'); setTimeout(()=>el.remove(), 240); }
  if(action){
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = ()=>{ action.fn(); remove(); };
    el.appendChild(b);
  }
  $('toasts').appendChild(el);
  while($('toasts').children.length > 4) $('toasts').firstElementChild.remove();
}

/* ---------- темы ---------- */
const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
function applyTheme(){
  const t = M.state.style.theme;
  const resolved = t === 'auto' ? ((mq && mq.matches) ? 'paper' : 'ink') : t;
  document.body.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta){
    const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
    if(bg) meta.setAttribute('content', bg);
  }
}
if(mq){
  const onScheme = ()=>{ if(M.state.style.theme === 'auto') applyTheme(); };
  if(mq.addEventListener) mq.addEventListener('change', onScheme);
  else if(mq.addListener) mq.addListener(onScheme);
}

/* ---------- перерисовка ---------- */
function renderAll(){
  if(rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(()=>{
    rafId = null;
    M.computeWarnings();
    V.render(); renderPeople(); renderBulk(); renderSeatCard(); renderWarnings(); renderStats(); renderHistoryButtons();
  });
}
function renderHistoryButtons(){ $('undoBtn').disabled = !M.canUndo(); $('redoBtn').disabled = !M.canRedo(); }
function renderSaveState(){
  const s = M.getSaveState(), dot = $('saveDot'), txt = $('saveState');
  if(s==='saving'){ dot.className = 'dot warn'; txt.textContent = 'Сохранение…'; }
  else if(s==='unavailable'){ dot.className = 'dot warn'; txt.textContent = 'Автосохранение недоступно'; }
  else { dot.className = 'dot'; txt.textContent = 'Сохранено локально'; }
}
function renderStats(){
  const st = M.stats();
  $('statPlaced').textContent = st.placed;
  $('statSeats').textContent = st.seats;
  $('docSeats').textContent = st.seats;
  $('statFree').textContent = st.free;
  $('progressBar').style.width = (st.seats ? st.placed/st.seats*100 : 0) + '%';
}

/* ---------- список ---------- */
function renderPeople(){
  vlist = M.visiblePeople();
  $('peopleCount').textContent = M.state.people.length;
  $('peopleSizer').style.height = (vlist.length*ROW_H) + 'px';
  if(!vlist.length){
    $('peopleRows').style.transform = 'translateY(0)';
    $('peopleRows').innerHTML = '<div class="empty-note">' +
      (M.state.people.length ? 'Ничего не найдено.<br>Измените поиск или фильтр.'
                             : 'Список пуст.<br>Загрузите CSV или добавьте участника вручную.') + '</div>';
    return;
  }
  drawRows();
}
function drawRows(){
  if(!vlist.length) return;
  const sc = $('peopleScroll');
  const top = sc.scrollTop, h = sc.clientHeight || 420;
  const start = Math.max(0, Math.floor(top/ROW_H)-4);
  const end = Math.min(vlist.length, Math.ceil((top+h)/ROW_H)+4);
  const pl = M.plan();
  let html = '';
  for(let i=start;i<end;i++){
    const p = vlist[i];
    const sid = M.seatOfPerson(p.id, pl);
    const other = !sid && M.placedElsewhere(p.id);
    const cls = ['prow'];
    if(sid) cls.push('placed');
    if(M.ui.selPerson===p.id) cls.push('sel');
    const badge = sid ? '<span class="p-seat">'+esc(sid)+'</span>'
      : other ? '<span class="p-seat other">др.</span>' : '<span class="p-seat free">—</span>';
    html += '<div class="'+cls.join(' ')+'" data-pid="'+p.id+'">' +
      '<input type="checkbox" class="cb no-drag" '+(M.ui.bulk.has(p.id)?'checked':'')+' aria-label="Выбрать">' +
      '<div class="p-name"><b>'+esc(M.surnameLine(p)||'—')+'</b><span>'+esc(M.givenLine(p)||'имя не указано')+'</span></div>' +
      badge +
      '<button class="p-edit no-drag" title="Карточка участника" aria-label="Карточка">' +
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button></div>';
  }
  $('peopleRows').style.transform = 'translateY(' + (start*ROW_H) + 'px)';
  $('peopleRows').innerHTML = html;
}
function renderBulk(){
  const n = M.ui.bulk.size;
  $('bulkBar').classList.toggle('on', n>0);
  $('bulkCount').textContent = n + ' из ' + M.state.people.length + ' выбрано';
  const all = M.visiblePeople();
  const allSelected = all.length>0 && all.every(p=>M.ui.bulk.has(p.id));
  const b = $('selectAllBtn');
  b.textContent = allSelected ? 'Все выделены' : 'Выделить всех';
  b.classList.toggle('primary', allSelected);
  b.classList.toggle('ghost', !allSelected);
}

/* ---------- карточка места ---------- */
function renderSeatCard(){
  const el = $('seatCard');
  const s = M.ui.selSeat ? M.seatById(M.ui.selSeat) : null;
  if(!s){
    el.innerHTML = '<div class="sc-block" style="margin:0">Кликните стул на схеме — здесь появится карточка места. ' +
      'Можно назначить участника из списка или перетащить фамилию мышью.</div>';
    return;
  }
  const pl = M.plan(), p = pl[s.id] ? M.personById(pl[s.id]) : null;
  const opts = ['<option value="">— свободно —</option>'].concat(
    M.state.people.slice().sort((a,b)=>M.fullName(a).localeCompare(M.fullName(b),'ru'))
      .map(x=>'<option value="'+x.id+'" '+(p&&p.id===x.id?'selected':'')+'>'+esc(M.fullName(x))+'</option>')).join('');
  el.innerHTML =
    '<div class="sc-id">'+esc(s.id)+'</div>' +
    '<div class="sc-block">'+esc(M.BLOCK_NAMES[s.block]||s.block)+' · размер '+M.fontPt(s)+'</div>' +
    '<div class="sc-name '+(p?'':'empty')+'">' +
      (p ? esc(M.surnameLine(p))+'<br><span style="font-weight:400;font-size:12.5px">'+esc(M.givenLine(p))+'</span>' : 'Место свободно') +
    '</div>' +
    '<select id="seatAssign">'+opts+'</select>' +
    '<div class="row"><button class="btn sm" id="seatFree" '+(p?'':'disabled')+'>Снять</button>' +
    '<button class="btn sm ghost" id="seatCardOpen" '+(p?'':'disabled')+'>Карточка</button></div>';
  $('seatAssign').onchange = e=>{ const v = e.target.value; if(v) doAssign(s.id, v); else doUnassign(s.id); };
  $('seatFree').onclick = ()=>doUnassign(s.id);
  $('seatCardOpen').onclick = ()=>{ if(p) openDrawer(p.id); };
}

/* ---------- замечания ---------- */
function renderWarnings(){
  const el = $('warnList'), ws = M.warnings;
  if(!ws.length){
    el.innerHTML = '<div class="allgood"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 12.5l5 5L20 6.5"/></svg><span>Подписи не пересекаются, всё внутри стен.</span></div>';
    $('warnStat').innerHTML = '<span class="dot"></span>Замечаний нет';
    return;
  }
  el.innerHTML = ws.slice(0,40).map((w,i)=>
    '<div class="warnitem '+(w.type==='err'?'err':'')+'" data-warn="'+i+'"><b>'+esc(w.seat)+'</b><span>'+esc(w.text)+
    '<br><span style="opacity:.85">'+esc(w.name||'')+'</span></span></div>').join('') +
    (ws.length>40 ? '<div style="font-size:11px;color:var(--txt-mute)">…и ещё '+(ws.length-40)+'</div>' : '');
  const errs = ws.filter(w=>w.type==='err').length;
  $('warnStat').innerHTML = '<span class="dot warn"></span>' + (errs ? errs+' ошибок, ' : '') + (ws.length-errs) + ' предупреждений';
  el.querySelectorAll('[data-warn]').forEach(n=>n.onclick = ()=>{
    const w = ws[+n.dataset.warn];
    M.ui.selSeat = w.seat;
    V.render(); renderSeatCard(); V.focusSeat(w.seat);
    if(document.body.clientWidth<=980) setMobilePanel('stage');
  });
}

/* ---------- рассадка ---------- */
function doAssign(seatId, pid){
  const res = M.assign(seatId, pid);
  if(!res.ok){ if(res.same) toast('info','Участник уже на этом месте'); return; }
  V.markPop(seatId);
  renderAll();
  toast('ok', M.personById(pid).last + ' → место ' + seatId, {label:'Отменить', fn:()=>{ M.undo(); renderAll(); }});
}
function doUnassign(seatId){
  if(!M.unassign(seatId)) return;
  renderAll();
  toast('info','Место '+seatId+' освобождено', {label:'Отменить', fn:()=>{ M.undo(); renderAll(); }});
}

/* ---------- перетаскивание ---------- */
function beginDrag(e, pid, fromSeat){
  drag = {pid, fromSeat, x0:e.clientX, y0:e.clientY, active:false, target:null};
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragUp);
  window.addEventListener('pointercancel', onDragUp);
}
function onDragMove(e){
  if(!drag) return;
  if(!drag.active){
    if(Math.hypot(e.clientX-drag.x0, e.clientY-drag.y0) < 5) return;
    const p = M.personById(drag.pid);
    if(!p){ endDrag(); return; }
    drag.active = true;
    const g = $('ghost');
    g.innerHTML = '<b>'+esc(M.surnameLine(p))+'</b><span>'+esc(M.givenLine(p))+'</span>';
    g.classList.add('on');
    V.wrap.classList.add('dragover');
    const row = $('peopleRows').querySelector('[data-pid="'+drag.pid+'"]');
    if(row) row.classList.add('dragging');
    document.body.style.userSelect = 'none';
  }
  const g = $('ghost');
  g.style.left = e.clientX+'px';
  g.style.top = (e.clientY-26)+'px';
  const id = V.seatAt(e.clientX, e.clientY);
  if(id !== drag.target){ V.highlight(id); drag.target = id; }
  e.preventDefault();
}
function onDragUp(){
  if(!drag) return;
  const active = drag.active, target = drag.target, pid = drag.pid;
  endDrag();
  if(active){
    lastDragEnd = Date.now();
    if(target) doAssign(target, pid);
    else toast('info','Отпустите фамилию на стуле — место не выбрано');
  } else {
    M.ui.selPerson = M.ui.selPerson===pid ? null : pid;
    renderPeople(); V.render();
    if(M.ui.selPerson){
      toast('info', M.personById(pid).last + ' выбран — кликните место на схеме');
      if(document.body.clientWidth<=980) setMobilePanel('stage');
    }
  }
}
function endDrag(){
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragUp);
  window.removeEventListener('pointercancel', onDragUp);
  $('ghost').classList.remove('on');
  V.wrap.classList.remove('dragover');
  V.highlight(null);
  const r = $('peopleRows').querySelector('.prow.dragging');
  if(r) r.classList.remove('dragging');
  document.body.style.userSelect = '';
  drag = null;
}

/* ---------- карточка участника ---------- */
function openDrawer(pid){
  drawerPid = pid;
  const p = pid ? M.personById(pid) : null;
  $('drawerTitle').textContent = p ? 'Карточка участника' : 'Новый участник';
  $('dLast').value = p ? p.last : '';
  $('dFirst').value = p ? p.first : '';
  $('dMiddle').value = p ? p.middle : '';
  $('drawerDelete').style.display = p ? '' : 'none';
  const pl = M.plan(), cur = p ? M.seatOfPerson(p.id, pl) : null;
  $('dSeat').innerHTML = ['<option value="">— без места —</option>'].concat(
    M.layout().seats.map(s=>{
      const occ = pl[s.id] ? M.personById(pl[s.id]) : null;
      const busy = occ && (!p || occ.id!==p.id);
      return '<option value="'+s.id+'" '+(cur===s.id?'selected':'')+'>'+esc(s.id)+' · '+
        esc(M.BLOCK_NAMES[s.block]||s.block)+(busy?' (занято: '+esc(occ.last)+')':'')+'</option>';
    })).join('');
  updateDrawerPreview();
  $('drawerScrim').classList.add('on');
  $('drawer').classList.add('on');
  setTimeout(()=>$('dLast').focus(), 260);
}
function closeDrawer(){ $('drawerScrim').classList.remove('on'); $('drawer').classList.remove('on'); drawerPid = null; }
function updateDrawerPreview(){
  const p = {last:$('dLast').value.trim(), first:$('dFirst').value.trim(), middle:$('dMiddle').value.trim()};
  $('drawerPreview').innerHTML = '<b>'+esc(M.surnameLine(p)||'ФАМИЛИЯ')+'</b><span>'+esc(M.givenLine(p)||'Имя Отчество')+'</span>';
  const full = M.fullName(p).toLocaleLowerCase('ru-RU');
  const dup = M.state.people.filter(x=>x.id!==drawerPid && M.fullName(x).toLocaleLowerCase('ru-RU')===full && full);
  const box = $('drawerDup');
  if(dup.length){
    box.style.display = 'block';
    box.textContent = 'В списке уже есть ' + dup.length + ' участник(ов) с таким же ФИО. Это допустимо — каждый займёт своё место, но приложение предупредит о совпадении.';
  } else box.style.display = 'none';
}

/* ---------- выгрузка ---------- */
function download(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
function fileBase(){
  const t = (M.state.meta.title||'schema').replace(/[^\wа-яА-ЯёЁ -]/g,'').trim().replace(/\s+/g,'-');
  return (t||'schema') + (M.state.meta.date ? '_'+M.state.meta.date : '');
}
function exportPdf(){
  try{
    const P = M.page();
    const cv = V.renderCanvas(M.state.style.dpi);
    const landscape = P.orientation === 'landscape';
    download(window.PDFWriter.fromCanvas(cv, 0.95, landscape), fileBase()+'.pdf');
    toast('ok','PDF сохранён · A4 ' + (landscape ? 'альбомный' : 'книжный') + ', '+M.state.style.dpi+' dpi');
  }catch(e){ toast('err','Не удалось создать PDF: '+e.message); }
}
function doPrint(){ $('printRoot').innerHTML = V.printSvg(); setTimeout(()=>window.print(), 60); }
function exportPng(){
  try{
    const cv = V.renderCanvas(M.state.style.dpi);
    cv.toBlob(b=>{
      if(b){ download(b, fileBase()+'.png'); toast('ok','PNG сохранён · '+cv.width+'×'+cv.height+' px'); }
      else toast('err','Браузер не смог создать PNG');
    }, 'image/png');
  }catch(e){ toast('err','Не удалось создать PNG: '+e.message); }
}
function exportProject(){
  const s = M.state, info = M.templateInfo();
  const data = {app:'schema-razmeshcheniya', schema:M.SCHEMA, templateSchema:info.schema,
    saved:new Date().toISOString(), hallId:s.hallId, layoutId:s.layoutId,
    meta:s.meta, people:s.people, plans:s.plans, style:s.style};
  download(new Blob([JSON.stringify(data,null,1)],{type:'application/json'}), fileBase()+'.json');
  toast('ok','Проект сохранён — его можно открыть и продолжить');
}
function exportCsvSeats(){
  download(new Blob([C.seatsCsv(M.layout(), M.plan(), M.personById)],{type:'text/csv;charset=utf-8'}), fileBase()+'_rassadka.csv');
  toast('ok','Выгружено мест: '+M.layout().seats.length+'. Файл можно править и загрузить обратно');
}
function exportCsvPeople(){
  download(new Blob([C.peopleCsv(M.state.people)],{type:'text/csv;charset=utf-8'}), fileBase()+'_uchastniki.csv');
  toast('ok','Список участников выгружен: '+M.state.people.length);
}
function openHelp(){
  const info = M.templateInfo();
  $('modal').innerHTML =
    '<div class="modal-head"><h2>Как пользоваться</h2><button class="btn icon ghost" data-close>×</button></div>' +
    '<div class="modal-body">' +
      '<div class="steps">' +
        '<div class="stepcard"><span class="n">1</span><div><b>Список участников.</b> Перетащите CSV в левую панель или нажмите «Добавить». Одна колонка: <b>Фамилия Имя Отчество</b>. Кнопка «Демо» подставит пример, «Свой» — ваш обычный список.</div></div>' +
        '<div class="stepcard"><span class="n">2</span><div><b>Рассадка.</b> Тяните фамилию на стул. Или кликните человека, затем место. Перетаскивание с занятого места на другое меняет участников местами. Правая панель показывает выбранное место и предупреждает, если подписи налезают друг на друга.</div></div>' +
        '<div class="stepcard"><span class="n">3</span><div><b>Документ.</b> Заполните мероприятие, помещение, дату и время в шапке. «Сохранить → PDF» даст лист A4 книжный. «Проект целиком» — файл, чтобы продолжить завтра. Рассадка сохраняется в браузере автоматически.</div></div>' +
      '</div>' +
      '<h4>Горячие клавиши</h4>' +
      '<div class="keys">' +
        '<div><span class="kbd">Ctrl+Z</span> отменить</div><div><span class="kbd">Ctrl+Y</span> повторить</div>' +
        '<div><span class="kbd">Ctrl+A</span> выделить всех</div><div><span class="kbd">Del</span> снять с места</div>' +
        '<div><span class="kbd">Ctrl+F</span> поиск</div><div><span class="kbd">Ctrl+S</span> сохранить проект</div>' +
        '<div><span class="kbd">Ctrl+P</span> печать</div><div><span class="kbd">Esc</span> сбросить выбор</div>' +
        '<div><span class="kbd">+</span> <span class="kbd">−</span> <span class="kbd">0</span> масштаб</div>' +
      '</div>' +
      '<h4>Данные</h4>' +
      '<p>Списки и рассадка хранятся только в вашем браузере и никуда не отправляются. Каждая расстановка помнит свою рассадку отдельно.</p>' +
      '<p style="color:var(--txt-mute);font-size:11.5px">Зал: '+esc(M.hall().name)+' · '+esc(M.layout().name)+' · '+info.seats+' мест · шаблоны: '+esc(info.source)+'</p>' +
    '</div>' +
    '<div class="modal-foot"><button class="btn primary" data-close>Понятно</button></div>';
  $('modalScrim').classList.add('on');
  $('modal').querySelectorAll('[data-close]').forEach(b=>b.onclick = ()=>$('modalScrim').classList.remove('on'));
  $('modalScrim').onclick = e=>{ if(e.target === $('modalScrim')) $('modalScrim').classList.remove('on'); };
}
function importDemoList(){ $('demoFileInput').click(); }
const actions = {pdf:exportPdf, png:exportPng, json:exportProject, 'csv-seats':exportCsvSeats,
  'csv-people':exportCsvPeople, print:doPrint, help:openHelp, 'demo-import':importDemoList};

/* ---------- импорт файлов ---------- */
function handleFile(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    const {text, enc} = C.decodeBuffer(reader.result);
    if(/\.json$/i.test(file.name) || /^\s*\{/.test(text)){
      let d;
      try{ d = JSON.parse(text); }catch(e){ toast('err','JSON не прочитан: '+e.message); return; }
      if(Array.isArray(d.halls)){
        try{
          M.setTemplates(d, 'файл');
          M.cacheAssets(d, null);
          const dropped = M.validate();
          syncControls(); V.fit(); renderAll();
          toast('ok','Шаблоны залов обновлены'+(dropped?(', снято привязок: '+dropped):''));
        }catch(e){ toast('err', e.message); }
        return;
      }
      if(!d.people){ toast('err','В JSON нет ни списка участников, ни шаблонов залов'); return; }
      const dropped = M.replaceAll(d);
      syncControls(); V.fit(); renderAll();
      toast('ok','Проект открыт: '+M.state.people.length+' участников');
      if(dropped) toast('warn', dropped+' привязок не совпали с текущей расстановкой и были сняты. Номера мест не изменялись.');
      return;
    }
    const seatMap = C.parseSeats(text);
    if(seatMap){
      const r = M.importSeatMap(seatMap);
      renderAll();
      toast('ok','Рассадка загружена: '+r.matched+' мест'+(r.created?', новых участников: '+r.created:'')+(r.unknown?', пропущено: '+r.unknown:''));
      return;
    }
    const res = C.parsePeople(text);
    if(!res.rows.length){ toast('err','В файле не найдено ни одного ФИО'); return; }
    C.previewModal({rows:res.rows, enc, name:file.name, delim:res.delim,
      onApply: mode=>{ const n = M.importPeople(res.rows, mode); renderAll(); toast('ok','Загружено участников: '+n); }});
  };
  reader.onerror = ()=>toast('err','Файл не прочитан');
  reader.readAsArrayBuffer(file);
}

/* ---------- загрузка шаблонов: сеть → кэш → папка ---------- */
function fetchJson(url){
  return fetch(url, {cache:'no-store'}).then(r=>{
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  });
}
function loadAssets(){
  return fetchJson('templates/halls.json')
    .then(halls=>{
      assetSource = 'сервер';
      return fetch('demo/demo-list.csv', {cache:'no-store'})
        .then(r=>r.ok ? r.arrayBuffer() : null)
        .then(buf=>{
          const demo = buf ? C.namesFromBuffer(buf) : null;
          M.cacheAssets(halls, demo);
          return {halls, demo: demo && demo.length ? demo : M.demoFallback(),
                  demoSource: demo && demo.length ? 'demo/demo-list.csv' : 'встроенный резерв'};
        })
        .catch(()=>{ M.cacheAssets(halls, null); return {halls, demo:M.demoFallback(), demoSource:'встроенный резерв'}; });
    })
    .catch(err=>{
      const cached = M.readCache();
      if(cached){
        assetSource = 'кэш';
        return {halls:cached.halls, demo:(cached.demo && cached.demo.length) ? cached.demo : M.demoFallback(),
                demoSource:(cached.demo && cached.demo.length) ? 'кэш папки' : 'встроенный резерв', at:cached.at};
      }
      if(IS_FILE) return askFolder();
      throw err;
    });
}
function askFolder(){
  return new Promise((resolve, reject)=>{
    const gate = $('gate'), errBox = $('gateErr');
    gate.hidden = false;
    errBox.hidden = true;
    const input = $('folderInput');
    const onPick = ()=>{ input.value = ''; input.click(); };
    $('gatePick').onclick = onPick;
    input.onchange = ()=>{
      const files = Array.from(input.files || []);
      input.value = '';
      readFolder(files).then(res=>{
        gate.hidden = true;
        input.onchange = null;
        assetSource = 'папка';
        M.cacheAssets(res.halls, res.demo);
        resolve(res);
      }).catch(e=>{
        errBox.hidden = false;
        errBox.textContent = e.message + ' Выберите папку, в которой лежат index.html и подпапка templates.';
      });
    };
    gate.onerror = reject;
  });
}
function readFolder(files){
  if(!files.length) return Promise.reject(new Error('Папка не выбрана.'));
  const path = f => (f.webkitRelativePath || f.name).replace(/\\/g,'/').toLowerCase();
  const hf = files.find(f=>path(f).endsWith('templates/halls.json'));
  if(!hf) return Promise.reject(new Error('В выбранной папке нет файла templates/halls.json.'));
  return hf.text().then(txt=>{
    let halls;
    try{ halls = JSON.parse(txt); }catch(e){ throw new Error('templates/halls.json повреждён: '+e.message); }
    if(!halls || !Array.isArray(halls.halls)) throw new Error('В templates/halls.json нет списка залов.');
    const df = files.find(f=>path(f).endsWith('demo/demo-list.csv'));
    if(!df) return {halls, demo:M.demoFallback(), demoSource:'встроенный резерв'};
    return df.arrayBuffer().then(buf=>{
      const names = C.namesFromBuffer(buf);
      return {halls, demo: names.length ? names : M.demoFallback(),
              demoSource: names.length ? 'demo/demo-list.csv' : 'встроенный резерв'};
    });
  });
}
function refreshFromFolder(){
  const input = $('folderInput');
  input.onchange = ()=>{
    const files = Array.from(input.files || []);
    input.value = '';
    input.onchange = null;
    readFolder(files).then(res=>{
      M.setTemplates(res.halls, 'папка');
      M.setDemo(res.demo, res.demoSource);
      M.cacheAssets(res.halls, res.demo);
      const dropped = M.validate();
      assetSource = 'папка';
      syncControls(); V.fit(); renderAll();
      toast('ok','Шаблоны обновлены из папки'+(dropped?(', снято привязок: '+dropped):''));
    }).catch(e=>toast('err', e.message));
  };
  input.click();
}

/* ---------- сохранённые виды ---------- */
function renderViews(){
  const el = $('viewsRow'), vs = M.views;
  if(!vs.length){ el.innerHTML = ''; return; }
  el.innerHTML = vs.map((v,i)=>'<span class="view-chip" data-v="'+i+'"><b>'+esc(v.name)+'</b><i data-del="'+i+'" title="Удалить вид">×</i></span>').join('');
  el.querySelectorAll('[data-v]').forEach(n=>n.onclick = e=>{
    if(e.target.dataset.del !== undefined){ M.removeView(+e.target.dataset.del); renderViews(); return; }
    const v = vs[+n.dataset.v];
    M.ui.search = v.search; M.ui.filter = v.filter; M.ui.sort = v.sort;
    $('searchInput').value = v.search; $('sortSel').value = v.sort;
    $('filterChips').querySelectorAll('.chip').forEach(c=>c.classList.toggle('on', c.dataset.filter===v.filter));
    renderPeople();
    toast('info','Вид «'+v.name+'» применён');
  });
}

/* ---------- элементы управления ---------- */
function fillHallSelects(){
  $('hallSel').innerHTML = M.halls.map(h=>'<option value="'+h.id+'">'+esc(h.name)+'</option>').join('');
  $('hallSel').value = M.state.hallId;
  $('layoutSel').innerHTML = M.hall().layouts.map(l=>'<option value="'+l.id+'">'+esc(l.name)+' · '+l.seats.length+' мест</option>').join('');
  $('layoutSel').value = M.layout().id;
}
function syncControls(){
  fillHallSelects();
  $('titleInput').value = M.state.meta.title||'';
  $('roomInput').value = M.state.meta.room||'';
  $('dateInput').value = M.state.meta.date||'';
  $('timeInput').value = M.state.meta.time||'';
  const s = M.state.style;
  $('cFontMain').value = s.fontMain;  $('oFontMain').textContent = s.fontMain+' pt';
  $('cFontSide').value = s.fontSide;  $('oFontSide').textContent = s.fontSide+' pt';
  $('cWeight').value = s.weight;
  $('cLeading').value = s.leading;    $('oLeading').textContent = Number(s.leading).toFixed(2);
  $('cTitle').value = s.titleSize;    $('oTitle').textContent = s.titleSize+' pt';
  $('cBand').value = s.band;          $('oBand').textContent = s.band+'%';
  $('cStroke').value = s.stroke;      $('oStroke').textContent = Number(s.stroke).toFixed(2)+' мм';
  $('cDpi').value = s.dpi;            $('oDpi').textContent = s.dpi+' dpi';
  $('cPaper').value = s.paper; $('cFurn').value = s.furn; $('cLabel').value = s.label; $('cAccent').value = s.accent;
  $('cFrames').checked = s.frames; $('cDoors').checked = s.doors; $('cWindows').checked = s.windows;
  $('cFurnLabels').checked = s.furnLabels; $('cIds').checked = s.ids;
  $('cTheme').value = s.theme;
  applyTheme();
}
function bindRange(id, key, fmt){
  const el = $(id), out = $('o'+id.slice(1));
  el.addEventListener('input', ()=>{
    const v = parseFloat(el.value);
    if(out) out.textContent = fmt(v);
    M.setStyle({[key]:v});
  });
  el.addEventListener('change', ()=>M.pushHistory('Оформление'));
}
function setMobilePanel(p){
  document.body.dataset.mpanel = p;
  $('mobileTabs').querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.mp===p));
  if(p==='stage') setTimeout(()=>V.onResize(), 30);
  if(p==='people') setTimeout(drawRows, 30);
}

function bind(){
  M.subscribe(reason=>{ if(reason==='save-state') renderSaveState(); else renderAll(); });

  $('hallSel').onchange = e=>{ M.switchHall(e.target.value); syncControls(); V.fit(); renderAll(); toast('info','Зал: '+M.hall().name); };
  $('layoutSel').onchange = e=>{ M.switchLayout(e.target.value); V.fit(); renderAll(); toast('info', M.layout().name+' · '+M.layout().seats.length+' мест'); };

  ['title','room','date','time'].forEach(k=>{
    const el = $(k+'Input');
    el.addEventListener('input', ()=>M.setMeta({[k]:el.value}));
    el.addEventListener('change', ()=>M.pushHistory('Реквизиты схемы'));
  });

  bindRange('cFontMain','fontMain', v=>v+' pt');
  bindRange('cFontSide','fontSide', v=>v+' pt');
  bindRange('cLeading','leading', v=>v.toFixed(2));
  bindRange('cTitle','titleSize', v=>v+' pt');
  bindRange('cBand','band', v=>v+'%');
  bindRange('cStroke','stroke', v=>v.toFixed(2)+' мм');
  bindRange('cDpi','dpi', v=>v+' dpi');
  $('cWeight').addEventListener('change', e=>{ M.setStyle({weight:e.target.value}); M.pushHistory('Насыщенность подписей'); });

  [['cPaper','paper'],['cFurn','furn'],['cLabel','label'],['cAccent','accent']].forEach(([id,key])=>{
    $(id).addEventListener('input', e=>M.setStyle({[key]:e.target.value}));
    $(id).addEventListener('change', ()=>M.pushHistory('Цвет'));
  });
  [['cFrames','frames'],['cDoors','doors'],['cWindows','windows'],['cFurnLabels','furnLabels'],['cIds','ids']]
    .forEach(([id,key])=>$(id).addEventListener('change', e=>{ M.setStyle({[key]:e.target.checked}); M.pushHistory('Оформление'); }));
  $('cTheme').addEventListener('change', e=>{ M.setStyle({theme:e.target.value}); applyTheme(); M.pushHistory('Тема'); });

  $('resetStyleBtn').onclick = ()=>{ M.setStyle(Object.assign({}, M.DEFAULT_STYLE)); syncControls(); M.pushHistory('Оформление сброшено'); toast('info','Оформление вернулось к исходному'); };
  $('randomStyleBtn').onclick = ()=>{
    const palettes = [
      {paper:'#f6f1e4',furn:'#e7ddc8',label:'#1a1a1a',accent:'#2fa07a'},
      {paper:'#ffffff',furn:'#e8eef3',label:'#12222c',accent:'#3d8fd6'},
      {paper:'#fbf6ec',furn:'#efe0c4',label:'#2b1f10',accent:'#c0392b'},
      {paper:'#f3f5f2',furn:'#dfe6df',label:'#1c2620',accent:'#6a8f3c'},
      {paper:'#f7f2f7',furn:'#e8dcea',label:'#241a2a',accent:'#8b6cd9'},
      {paper:'#fdf8f0',furn:'#f0e2cc',label:'#20180d',accent:'#d9a441'}
    ];
    const pool = palettes.filter(p=>p.paper !== M.state.style.paper);
    M.setStyle(pool[Math.floor(Math.random()*pool.length)]);
    syncControls(); M.pushHistory('Палитра подобрана');
    toast('ok','Палитра листа обновлена');
  };

  $('zoomRange').addEventListener('input', e=>V.setZoomPercent(parseFloat(e.target.value)));
  $('zoomIn').onclick = ()=>V.zoomCenter(1.2);
  $('zoomOut').onclick = ()=>V.zoomCenter(1/1.2);
  $('fitBtn').onclick = ()=>V.fit();
  $('folderBtn').onclick = refreshFromFolder;
  $('clearSeatsBtn').onclick = ()=>{
    const n = M.clearSeats();
    if(!n){ toast('info','Рассадка и так пуста'); return; }
    renderAll();
    toast('warn','Рассадка очищена ('+n+' мест)', {label:'Отменить', fn:()=>{ M.undo(); renderAll(); }});
  };

  $('searchInput').addEventListener('input', e=>{ M.ui.search = e.target.value; $('peopleScroll').scrollTop = 0; renderPeople(); });
  $('sortSel').addEventListener('change', e=>{ M.ui.sort = e.target.value; renderPeople(); });
  $('filterChips').addEventListener('click', e=>{
    const b = e.target.closest('.chip'); if(!b) return;
    M.ui.filter = b.dataset.filter;
    $('filterChips').querySelectorAll('.chip').forEach(c=>c.classList.toggle('on', c===b));
    $('peopleScroll').scrollTop = 0; renderPeople();
  });
  $('addPersonBtn').onclick = ()=>openDrawer(null);
  $('peopleScroll').addEventListener('scroll', drawRows, {passive:true});

  $('peopleRows').addEventListener('pointerdown', e=>{
    const row = e.target.closest('.prow'); if(!row) return;
    if(e.target.closest('.no-drag')) return;
    if(e.pointerType==='mouse' && e.button!==0) return;
    beginDrag(e, row.dataset.pid, null);
  });
  $('peopleRows').addEventListener('click', e=>{
    if(Date.now()-lastDragEnd < 250) return;
    const row = e.target.closest('.prow'); if(!row) return;
    const pid = row.dataset.pid;
    if(e.target.classList.contains('cb')){
      if(e.target.checked) M.ui.bulk.add(pid); else M.ui.bulk.delete(pid);
      renderBulk(); return;
    }
    if(e.target.closest('.p-edit')) openDrawer(pid);
  });
  $('peopleRows').addEventListener('dblclick', e=>{
    const row = e.target.closest('.prow'); if(row) openDrawer(row.dataset.pid);
  });

  $('selectAllBtn').onclick = ()=>{
    const arr = M.visiblePeople();
    if(!arr.length){ toast('info','Нет участников для выделения'); return; }
    const allSelected = arr.every(p=>M.ui.bulk.has(p.id));
    if(allSelected) arr.forEach(p=>M.ui.bulk.delete(p.id));
    else arr.forEach(p=>M.ui.bulk.add(p.id));
    renderPeople(); renderBulk();
    toast('info', allSelected ? 'Выделение снято' : 'Выделено: '+M.ui.bulk.size+' из '+M.state.people.length);
  };
  $('selectAllFreeBtn').onclick = ()=>{
    const pl = M.plan();
    const free = M.visiblePeople().filter(p=>!M.seatOfPerson(p.id, pl));
    if(!free.length){ toast('info','Среди показанных нет неразмещённых'); return; }
    free.forEach(p=>M.ui.bulk.add(p.id));
    renderPeople(); renderBulk();
    toast('info','Выделены неразмещённые: '+M.ui.bulk.size);
  };
  $('selectNoneBtn').onclick = ()=>{
    if(!M.ui.bulk.size){ toast('info','Никто не выделен'); return; }
    M.ui.bulk.clear(); renderPeople(); renderBulk();
  };
  $('clearPeopleBtn').onclick = ()=>{
    const n = M.state.people.length;
    if(!n){ toast('info','Список и так пуст'); return; }
    if(!confirm('Удалить весь список участников ('+n+' чел.) и всю рассадку? Действие можно отменить.')) return;
    M.clearPeople(); renderAll();
    toast('warn','Список очищен: удалено '+n+' участников', {label:'Отменить', fn:()=>{ M.undo(); renderAll(); }});
  };
  $('bulkClear').onclick = ()=>{ M.ui.bulk.clear(); renderPeople(); renderBulk(); };
  $('bulkUnassign').onclick = ()=>{
    const n = M.unassignPeople([...M.ui.bulk]);
    M.ui.bulk.clear(); renderAll();
    toast(n?'warn':'info', n?('Снято с мест: '+n):'Среди выбранных нет размещённых', n?{label:'Отменить', fn:()=>{ M.undo(); renderAll(); }}:null);
  };
  $('bulkDelete').onclick = ()=>{
    if(!M.ui.bulk.size) return;
    const n = M.deletePeople([...M.ui.bulk]);
    renderAll();
    toast('warn','Удалено участников: '+n, {label:'Отменить', fn:()=>{ M.undo(); renderAll(); }});
  };
  $('demoBtn').onclick = ()=>{
    const n = M.applyDemo(true);
    renderAll();
    toast('ok','Демо-список: '+n+' участников · '+M.demoInfo().source);
  };
  $('demoOwnBtn').onclick = importDemoList;
  $('demoFileInput').addEventListener('change', e=>{
    const f = e.target.files[0]; e.target.value = '';
    if(!f) return;
    const rd = new FileReader();
    rd.onload = ()=>{
      const rows = C.parsePeople(C.decodeBuffer(rd.result).text).rows;
      if(!rows.length){ toast('err','В файле не найдено ни одного ФИО'); return; }
      const names = rows.map(r=>[r.last,r.first,r.middle].filter(Boolean).join(' '));
      lastDemoNames = names;
      M.setDemo(names, 'свой файл: '+f.name);
      const n = M.applyDemo(true);
      renderAll();
      toast('ok','Свой список применён: '+n+' участников');
    };
    rd.onerror = ()=>toast('err','Файл не прочитан');
    rd.readAsArrayBuffer(f);
  });
  $('saveViewBtn').onclick = ()=>{
    const name = prompt('Название вида (поиск + фильтр + сортировка):', M.ui.search || (M.ui.filter==='free'?'Свободные':'Мой вид'));
    if(!name) return;
    M.addView({name:name.slice(0,28), search:M.ui.search, filter:M.ui.filter, sort:M.ui.sort});
    renderViews(); toast('ok','Вид сохранён');
  };

  const wrap = V.wrap;
  wrap.addEventListener('pointerdown', e=>{
    const seatEl = e.target.closest ? e.target.closest('[data-seat]') : null;
    if(seatEl){
      const id = seatEl.getAttribute('data-seat');
      const pid = M.plan()[id];
      if(pid) beginDrag(e, pid, id);
      return;
    }
    if(e.pointerType==='mouse' && e.button!==0) return;
    pan = {x:e.clientX, y:e.clientY};
    wrap.classList.add('panning');
    try{ wrap.setPointerCapture(e.pointerId); }catch(_){}
  });
  wrap.addEventListener('pointermove', e=>{
    if(!pan) return;
    V.panBy(e.clientX-pan.x, e.clientY-pan.y);
    pan.x = e.clientX; pan.y = e.clientY;
  });
  const endPan = e=>{ if(pan){ pan = null; wrap.classList.remove('panning'); try{ wrap.releasePointerCapture(e.pointerId); }catch(_){} } };
  wrap.addEventListener('pointerup', endPan);
  wrap.addEventListener('pointercancel', endPan);
  wrap.addEventListener('click', e=>{
    if(drag || Date.now()-lastDragEnd < 250) return;
    const seatEl = e.target.closest ? e.target.closest('[data-seat]') : null;
    if(!seatEl){ M.ui.selSeat = null; renderSeatCard(); V.render(); return; }
    const id = seatEl.getAttribute('data-seat');
    if(M.ui.selPerson){
      const pid = M.ui.selPerson;
      M.ui.selPerson = null; M.ui.selSeat = id;
      doAssign(id, pid); renderPeople();
      return;
    }
    M.ui.selSeat = M.ui.selSeat===id ? null : id;
    renderSeatCard(); V.render();
    if(document.body.clientWidth<=980 && M.ui.selSeat) setMobilePanel('style');
  });
  wrap.addEventListener('dblclick', e=>{
    const seatEl = e.target.closest ? e.target.closest('[data-seat]') : null;
    if(!seatEl) return;
    const pid = M.plan()[seatEl.getAttribute('data-seat')];
    if(pid) openDrawer(pid);
  });
  wrap.addEventListener('wheel', e=>{
    e.preventDefault();
    const r = V.rect();
    V.zoomAt(e.clientX-r.left, e.clientY-r.top, e.deltaY<0 ? 1.12 : 1/1.12);
  }, {passive:false});

  ['dLast','dFirst','dMiddle'].forEach(id=>$(id).addEventListener('input', updateDrawerPreview));
  $('drawerSave').onclick = ()=>{
    const last = $('dLast').value.trim(), first = $('dFirst').value.trim(), middle = $('dMiddle').value.trim();
    if(!last){ toast('err','Укажите фамилию'); $('dLast').focus(); return; }
    const p = M.savePerson({last, first, middle}, drawerPid);
    const want = $('dSeat').value, cur = M.seatOfPerson(p.id);
    if(want && want!==cur){ M.assign(want, p.id); V.markPop(want); }
    else if(!want && cur) M.unassign(cur);
    closeDrawer(); renderAll();
    toast('ok','Сохранено: '+M.fullName(p));
  };
  $('drawerDelete').onclick = ()=>{
    const p = M.personById(drawerPid); if(!p) return;
    const name = M.fullName(p);
    M.deletePeople([p.id]);
    closeDrawer(); renderAll();
    toast('warn','Удалён: '+name, {label:'Отменить', fn:()=>{ M.undo(); renderAll(); }});
  };
  $('drawerClose').onclick = closeDrawer;
  $('drawerScrim').onclick = closeDrawer;

  $('fileInput').addEventListener('change', e=>{ const f = e.target.files[0]; if(f) handleFile(f); e.target.value = ''; });
  $('dropZone').onclick = ()=>$('fileInput').click();
  $('openBtn').onclick = ()=>$('fileInput').click();
  ['dragenter','dragover'].forEach(ev=>$('dropZone').addEventListener(ev, e=>{ e.preventDefault(); $('dropZone').classList.add('hot'); }));
  ['dragleave','drop'].forEach(ev=>$('dropZone').addEventListener(ev, e=>{ e.preventDefault(); $('dropZone').classList.remove('hot'); }));
  $('dropZone').addEventListener('drop', e=>{ const f = e.dataTransfer.files[0]; if(f) handleFile(f); });
  window.addEventListener('dragover', e=>{ if(e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e=>{
    if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){ e.preventDefault(); handleFile(e.dataTransfer.files[0]); }
  });

  $('exportBtn').onclick = e=>{ e.stopPropagation(); $('exportMenu').classList.toggle('open'); };
  document.addEventListener('click', e=>{ if(!e.target.closest('.menu-wrap')) $('exportMenu').classList.remove('open'); });
  $('exportMenu').addEventListener('click', e=>{
    const b = e.target.closest('[data-act]'); if(!b) return;
    $('exportMenu').classList.remove('open');
    actions[b.dataset.act]();
  });
  document.querySelectorAll('[data-quick]').forEach(b=>b.onclick = ()=>actions[b.dataset.quick]());

  $('newBtn').onclick = ()=>{
    if(!confirm('Начать новую схему? Текущие участники и рассадка будут очищены (действие можно отменить).')) return;
    M.newScheme(); syncControls(); renderAll();
    toast('warn','Схема очищена', {label:'Отменить', fn:()=>{ M.undo(); syncControls(); renderAll(); }});
  };
  $('undoBtn').onclick = ()=>{ const l = M.undo(); if(l){ syncControls(); renderAll(); toast('info','Отменено: '+l); } };
  $('redoBtn').onclick = ()=>{ const l = M.redo(); if(l){ syncControls(); renderAll(); toast('info','Повторено: '+l); } };
  $('onboardClose').onclick = ()=>{ $('onboard').style.display = 'none'; try{ localStorage.setItem('schema-onboard','1'); }catch(e){} };
  $('mobileTabs').addEventListener('click', e=>{ const b = e.target.closest('[data-mp]'); if(b) setMobilePanel(b.dataset.mp); });

  document.addEventListener('keydown', e=>{
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if(mod && k==='z'){ e.preventDefault(); const l = e.shiftKey ? M.redo() : M.undo(); if(l){ syncControls(); renderAll(); toast('info',(e.shiftKey?'Повторено: ':'Отменено: ')+l); } return; }
    if(mod && k==='y'){ e.preventDefault(); const l = M.redo(); if(l){ syncControls(); renderAll(); toast('info','Повторено: '+l); } return; }
    if(mod && k==='s'){ e.preventDefault(); exportProject(); return; }
    if(mod && k==='p'){ e.preventDefault(); doPrint(); return; }
    if(mod && k==='f'){ e.preventDefault(); setMobilePanel('people'); $('searchInput').focus(); return; }
    if(mod && k==='a' && !typing){
      e.preventDefault();
      const arr = M.visiblePeople();
      if(!arr.length){ toast('info','Нет участников для выделения'); return; }
      arr.forEach(p=>M.ui.bulk.add(p.id));
      setMobilePanel('people'); renderPeople(); renderBulk();
      toast('ok','Выделено: '+M.ui.bulk.size+' из '+M.state.people.length);
      return;
    }
    if(e.key==='Escape'){
      if($('modalScrim').classList.contains('on')){ $('modalScrim').classList.remove('on'); return; }
      if($('drawer').classList.contains('on')){ closeDrawer(); return; }
      if(drag){ endDrag(); return; }
      M.ui.selPerson = null; M.ui.selSeat = null;
      renderPeople(); renderSeatCard(); V.render(); return;
    }
    if(typing) return;
    if(e.key==='Delete' || e.key==='Backspace'){
      if(M.ui.bulk.size){ e.preventDefault(); $('bulkDelete').click(); return; }
      if(M.ui.selSeat && M.plan()[M.ui.selSeat]){ e.preventDefault(); doUnassign(M.ui.selSeat); }
      else if(M.ui.selPerson){ e.preventDefault(); openDrawer(M.ui.selPerson); }
    }
    if(e.key==='+' || e.key==='=') V.zoomCenter(1.2);
    if(e.key==='-') V.zoomCenter(1/1.2);
    if(e.key==='0') V.fit();
  });

  window.addEventListener('beforeprint', ()=>{ $('printRoot').innerHTML = V.printSvg(); });
  let rt = null;
  new ResizeObserver(()=>{ clearTimeout(rt); rt = setTimeout(()=>{ V.onResize(); drawRows(); }, 60); }).observe(V.wrap);
}

/* ---------- старт ---------- */
function boot(){
  V.init();
  loadAssets().then(res=>{
    M.setTemplates(res.halls, assetSource);
    M.setDemo(res.demo, res.demoSource);
    const restored = M.loadSaved();
    if(!restored) M.applyDemo(true);
    M.loadViews();
    try{ if(localStorage.getItem('schema-onboard')) $('onboard').style.display = 'none'; }catch(e){}
    syncControls(); renderViews(); bind();
    V.fit();
    M.resetHistory(); renderHistoryButtons();
    M.scheduleSave();
    renderAll();
    if(document.body.clientWidth<=980) setMobilePanel('stage');
    setTimeout(()=>{ V.fit(); V.render(); drawRows(); }, 140);

    if(IS_FILE){
      const btn = $('folderBtn');
      btn.hidden = false;
      const at = res.at || M.cacheDate();
      btn.title = at ? ('Шаблоны загружены ' + new Date(at).toLocaleString('ru-RU')) : 'Выбрать папку проекта заново';
    }
    if(restored) toast('info','Восстановлена последняя схема — можно продолжать');
    else toast('ok','Готово к работе: '+M.hall().name+' · '+M.layout().name+' · '+M.layout().seats.length+' мест');
    if(IS_FILE && assetSource === 'кэш'){
      setTimeout(()=>toast('info','Шаблоны взяты из памяти браузера. Поправили JSON — нажмите «Обновить из папки».',
        {label:'Обновить', fn:refreshFromFolder}), 700);
    }
  }).catch(err=>{
    const d = document.createElement('div');
    d.className = 'boot-error';
    d.innerHTML = '<div><b>Не удалось загрузить шаблоны залов</b>' +
      'Проверьте, что рядом с index.html лежит папка templates с файлом halls.json.<br><br>' +
      '<span style="opacity:.75">' + esc(err.message) + '</span><br><br>' +
      '<button class="btn primary" onclick="location.reload()">Повторить</button></div>';
    document.body.appendChild(d);
  });
}
boot();
})();