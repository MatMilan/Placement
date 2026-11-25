/* Единое состояние, история, автосохранение, геометрия подписей, проверка схемы.
   Шаблоны приходят извне (JSON с сервера, из папки или из кэша) — здесь их только разбирают.
   Формат листа задаёт расстановка: поле "page" (по умолчанию A4 книжный). */
   (function(){
    "use strict";
    
    const MM_PER_PT = 25.4/72;
    const PAGE_PORTRAIT = {w:210, h:297, orientation:'portrait'};
    const PAGE_LANDSCAPE = {w:297, h:210, orientation:'landscape'};
    const SCHEMA = 6;
    const FONT_STACK = '"PT Serif","PT Astra Serif","Times New Roman",Times,Georgia,serif';
    const STORE_KEY = 'schema-razmeshcheniya-v3';
    const VIEWS_KEY = 'schema-views-v3';
    const CACHE_KEY = 'schema-assets-v3';
    
    const BLOCK_NAMES = {
      main_left:'Основной стол · левая сторона', main_right:'Основной стол · правая сторона',
      table_left:'Стол · левая сторона', table_right:'Стол · правая сторона',
      end_top:'Торец стола · верхний', end_bottom:'Торец стола · нижний',
      wall_left:'Стулья у левой стены', wall_right:'Стулья у правой стены',
      grid9:'Дополнительный блок 3×3',
      presidium:'Председательское место', presidium_pair:'Председательские места · два',
      audience:'Зал · места участников', observers:'Места для приглашённых',
      top_row:'Верхняя сторона стола', arm_left:'Левая сторона П-стола', arm_right:'Правая сторона П-стола',
      arm_end_left:'Торец левой стороны', arm_end_right:'Торец правой стороны',
      oval_left:'Овальный стол · слева', oval_right:'Овальный стол · справа',
      front_row:'Студия · фронтальный ряд', desk_row:'Рабочие места',
      round_left:'Круглый стол · слева', round_right:'Круглый стол · справа'
    };
    
    const DEFAULT_STYLE = {
      fontMain:9, fontSide:7, leading:1, titleSize:13, band:100, stroke:0.35, weight:'surname',
      paper:'#f6f1e4', furn:'#e7ddc8', label:'#1a1a1a', accent:'#2fa07a',
      frames:false, doors:true, windows:true, furnLabels:true, ids:true, theme:'ink', dpi:300
    };
    
    const DEMO_FALLBACK = [
      'Краснов Аркадий Гавриилович','Белов Семён Витальевич','Соловьев Владимир Геннадьевич',
      'Мещерякова Маргарита Александровна','Преображенский Александр Александрович',
      'Виноградова Виолетта Романовна','Скоробельский Семён Дежневович','Комисаренко Александр Николаевич'
    ];
    
    const uid = () => 'p' + Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-3);
    const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
    const clone = o => JSON.parse(JSON.stringify(o));
    const r2 = v => Math.round(v*100)/100;
    
    const meas = document.createElement('canvas').getContext('2d');
    const wcache = new Map();
    function textW(text, sizeMm, bold){
      if(!text) return 0;
      const key = (bold?'B|':'R|') + text;
      let base = wcache.get(key);
      if(base === undefined){
        meas.font = (bold?'700 ':'400 ') + '100px ' + FONT_STACK;
        base = meas.measureText(text).width / 100;
        if(wcache.size > 6000) wcache.clear();
        wcache.set(key, base);
      }
      return base * sizeMm;
    }
    
    const state = {
      hallId:'zas', layoutId:'zas1',
      meta:{title:'Схема размещения', room:'Зал заседаний', date:'2026-10-25', time:'10:30'},
      people:[], plans:{}, style:Object.assign({}, DEFAULT_STYLE)
    };
    const ui = {search:'', filter:'all', sort:'alpha', selPerson:null, selSeat:null, bulk:new Set()};
    
    let halls = [];
    let templateSource = '—';
    let templateSchema = 0;
    let demoList = DEMO_FALLBACK.slice();
    let demoSource = 'встроенный резерв';
    let history = [], hIndex = -1;
    let warnings = [];
    let savedViews = [];
    const listeners = [];
    let saveTimer = null, saveState = 'idle';
    
    function emit(reason){ listeners.forEach(fn=>{ try{ fn(reason); }catch(e){ console.error(e); } }); }
    function subscribe(fn){ listeners.push(fn); }
    
    function chairObj(c){
      return Array.isArray(c) ? {x:c[0], y:c[1], w:c[2], h:c[3]} : {x:c.x, y:c.y, w:c.w, h:c.h};
    }
    function normalizePage(p){
      if(!p) return null;
      const o = Object.assign({}, PAGE_PORTRAIT, p);
      if(o.orientation === 'landscape'){ o.w = Math.max(o.w, o.h); o.h = Math.min(o.w, o.h); }
      return o;
    }
    function expandRows(rows){
      const out = [];
      (rows||[]).forEach(spec=>{
        const w = spec.chair.w, h = spec.chair.h;
        const cols = spec.cols || [0];
        const rr = spec.rows || {y0:0, step:0, count:1};
        const count = rr.count || 1, step = rr.step || 0;
        let n = spec.idFrom || 1;
        for(let i=0;i<count;i++){
          const y = rr.y0 + i*step;
          cols.forEach(cx=>{
            const x = spec.anchor === 'left' ? cx : cx - w/2;
            out.push({
              id:'s' + String(n++).padStart(2,'0'),
              block:spec.block,
              chair:{x:r2(x), y:r2(y), w, h},
              font:spec.font || 'side',
              zone:clone(spec.zone || {kind:'below', gap:0.8})
            });
          });
        }
      });
      return out;
    }
    function normalizeHall(h){
      const layouts = [], byId = {};
      (h.layouts||[]).forEach(raw=>{
        let L;
        if(raw.from){
          const base = byId[raw.from];
          if(!base) throw new Error('расстановка «'+raw.id+'» ссылается на неизвестную «'+raw.from+'»');
          L = {id:raw.id, name:raw.name, page:clone(base.page), room:clone(base.room),
               doors:clone(base.doors), windows:clone(base.windows),
               furniture:clone(base.furniture), seats:clone(base.seats)};
          if(raw.page) L.page = normalizePage(raw.page);
          if(raw.room) L.room = clone(raw.room);
          if(raw.doors) L.doors = clone(raw.doors);
          if(raw.windows) L.windows = clone(raw.windows);
          if(raw.keepFurniture) L.furniture = L.furniture.filter(f=>raw.keepFurniture.indexOf(f.id)>=0);
          if(raw.hideFurniture) L.furniture = L.furniture.filter(f=>raw.hideFurniture.indexOf(f.id)<0);
          if(raw.addFurniture) L.furniture = L.furniture.concat(clone(raw.addFurniture));
          if(raw.keepBlocks) L.seats = L.seats.filter(s=>raw.keepBlocks.indexOf(s.block)>=0);
          if(raw.hideBlocks) L.seats = L.seats.filter(s=>raw.hideBlocks.indexOf(s.block)<0);
          if(raw.keepSeats) L.seats = L.seats.filter(s=>raw.keepSeats.indexOf(s.id)>=0);
          if(raw.hideSeats) L.seats = L.seats.filter(s=>raw.hideSeats.indexOf(s.id)<0);
        } else {
          L = {
            id:raw.id, name:raw.name,
            page: normalizePage(raw.page) || clone(PAGE_PORTRAIT),
            room:clone(raw.room),
            doors:clone(raw.doors||[]), windows:clone(raw.windows||[]), furniture:clone(raw.furniture||[]),
            seats:(raw.seats||[]).map(s=>({
              id:s.id, block:s.block, chair:chairObj(s.chair), font:s.font||'side',
              zone:clone(s.zone||{kind:'below', gap:0.8})
            })).concat(expandRows(raw.seatRows))
          };
        }
        L.seats.sort((a,b)=>a.id.localeCompare(b.id, undefined, {numeric:true}));
        byId[L.id] = L;
        if(!raw.hidden) layouts.push(L);
      });
      if(!layouts.length) throw new Error('в зале «'+h.name+'» нет ни одной видимой расстановки');
      return {id:h.id, name:h.name, layouts};
    }
    function setTemplates(raw, source){
      if(!raw || !Array.isArray(raw.halls) || !raw.halls.length) throw new Error('в шаблонах нет списка залов');
      halls = raw.halls.map(normalizeHall);
      templateSource = source || 'JSON';
      templateSchema = raw.schema || 0;
      if(!halls.some(h=>h.id===state.hallId)) state.hallId = halls[0].id;
      const h = hall();
      if(!h.layouts.some(l=>l.id===state.layoutId)) state.layoutId = h.layouts[0].id;
      return halls;
    }
    function templateInfo(){
      const L = layout();
      return {source:templateSource, schema:templateSchema, seats:L?L.seats.length:0};
    }
    
    function cacheAssets(hallsRaw, demo){
      try{ localStorage.setItem(CACHE_KEY, JSON.stringify({halls:hallsRaw, demo, at:new Date().toISOString()})); }
      catch(e){}
    }
    function readCache(){
      try{
        const raw = localStorage.getItem(CACHE_KEY);
        if(!raw) return null;
        const d = JSON.parse(raw);
        if(!d || !d.halls || !Array.isArray(d.halls.halls)) return null;
        return d;
      }catch(e){ return null; }
    }
    function cacheDate(){ const c = readCache(); return c ? c.at : null; }
    
    function setDemo(names, source){
      demoList = (Array.isArray(names) && names.length) ? names.slice() : DEMO_FALLBACK.slice();
      demoSource = source || 'demo/demo-list.csv';
    }
    function demoInfo(){ return {source:demoSource, count:demoList.length}; }
    function demoFallback(){ return DEMO_FALLBACK.slice(); }
    function applyDemo(preset){
      state.people = demoList.map(n=>{ const q = parseFio(n); return {id:uid(), last:q.last, first:q.first, middle:q.middle}; });
      state.plans = {};
      ui.bulk.clear(); ui.selPerson = null; ui.selSeat = null;
      const L = layout();
      if(L && preset !== false){
        const pl = plan();
        const order = ['presidium','presidium_pair','end_top','main_left','main_right','table_left','table_right',
                       'end_bottom','wall_left','wall_right','grid9','audience','observers','top_row','arm_left','arm_right',
                       'oval_left','oval_right','arm_end_left','arm_end_right','front_row','desk_row','round_left','round_right'];
        const ordered = L.seats.slice().sort((a,b)=>order.indexOf(a.block)-order.indexOf(b.block));
        const take = Math.min(24, ordered.length, state.people.length);
        for(let i=0;i<take;i++) pl[ordered[i].id] = state.people[i].id;
      }
      pushHistory('Демо-список загружен'); emit('people');
      return state.people.length;
    }
    
    function hall(){ return halls.find(h=>h.id===state.hallId) || halls[0]; }
    function layout(){ const h = hall(); return (h && (h.layouts.find(l=>l.id===state.layoutId) || h.layouts[0])) || null; }
    /* Формат листа текущей расстановки: {w, h, orientation}. По умолчанию A4 книжный. */
    function page(){
      const L = layout();
      return (L && L.page) ? L.page : PAGE_PORTRAIT;
    }
    function planKey(){ return state.hallId + '/' + (layout() ? layout().id : state.layoutId); }
    function plan(){ const k = planKey(); if(!state.plans[k]) state.plans[k] = {}; return state.plans[k]; }
    function personById(id){ return state.people.find(p=>p.id===id) || null; }
    function seatById(id){ const L = layout(); return L ? (L.seats.find(s=>s.id===id) || null) : null; }
    function fullName(p){ return p ? [p.last,p.first,p.middle].filter(Boolean).join(' ') : ''; }
    function surnameLine(p){ return p ? String(p.last||'').toLocaleUpperCase('ru-RU') : ''; }
    function givenLine(p){ return p ? [p.first,p.middle].filter(Boolean).join(' ') : ''; }
    function seatOfPerson(pid, pl){ pl = pl || plan(); for(const k in pl) if(pl[k]===pid) return k; return null; }
    function placedElsewhere(pid){
      const cur = planKey();
      for(const k in state.plans){ if(k===cur) continue; const pl = state.plans[k]; for(const s in pl) if(pl[s]===pid) return true; }
      return false;
    }
    function parseFio(line){
      const s = String(line||'').trim().replace(/\s+/g,' ');
      if(!s) return {last:'', first:'', middle:''};
      const p = s.split(' ');
      return {last:p[0]||'', first:p[1]||'', middle:p.slice(2).join(' ')};
    }
    function titleTexts(){
      const m = state.meta;
      let d = m.date || '';
      if(/^\d{4}-\d{2}-\d{2}$/.test(d)){ const a = d.split('-'); d = a[2]+'.'+a[1]+'.'+a[0]; }
      const inner = [m.room, [d, m.time].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      return {main:m.title || 'Схема размещения', sub: inner ? '('+inner+')' : ''};
    }
    function stats(){
      const L = layout(); if(!L) return {placed:0, seats:0, free:0};
      const pl = plan();
      const placed = L.seats.filter(s=>pl[s.id] && personById(pl[s.id])).length;
      return {placed, seats:L.seats.length, free:state.people.filter(p=>!seatOfPerson(p.id, pl)).length};
    }
    function visiblePeople(){
      const pl = plan(), L = layout();
      const q = ui.search.trim().toLocaleLowerCase('ru-RU');
      let arr = state.people.slice();
      if(q) arr = arr.filter(p=>fullName(p).toLocaleLowerCase('ru-RU').includes(q));
      if(ui.filter==='free') arr = arr.filter(p=>!seatOfPerson(p.id, pl));
      if(ui.filter==='placed') arr = arr.filter(p=>!!seatOfPerson(p.id, pl));
      const idx = {}; if(L) L.seats.forEach((s,i)=>idx[s.id]=i);
      const byName = (a,b)=>fullName(a).localeCompare(fullName(b),'ru');
      if(ui.sort==='alpha') arr.sort(byName);
      else if(ui.sort==='seat') arr.sort((a,b)=>{
        const sa = seatOfPerson(a.id, pl), sb = seatOfPerson(b.id, pl);
        if(sa && sb) return idx[sa]-idx[sb];
        if(sa) return -1; if(sb) return 1; return byName(a,b);
      });
      else if(ui.sort==='status') arr.sort((a,b)=>{
        const fa = seatOfPerson(a.id, pl)?1:0, fb = seatOfPerson(b.id, pl)?1:0;
        return fa-fb || byName(a,b);
      });
      return arr;
    }
    
    function fontPt(seat){ return seat.font==='main' ? state.style.fontMain : state.style.fontSide; }
    function weights(){
      const w = state.style.weight;
      return {b0: w !== 'none', b1: w === 'all'};
    }
    function labelBox(seat, p){
      const pt = fontPt(seat), lead = state.style.leading, sizeMm = pt*MM_PER_PT;
      const wt = weights();
      const lines = [surnameLine(p), givenLine(p)];
      const w = Math.max(textW(lines[0], sizeMm, wt.b0), textW(lines[1], sizeMm, wt.b1), 6);
      const h = 2*sizeMm*lead;
      const c = seat.chair, cx = c.x+c.w/2, cy = c.y+c.h/2, z = seat.zone;
      let x, y, anchor, ax;
      if(z.kind==='band'){
        const zw = z.w * state.style.band/100;
        if(z.align==='right'){ x = z.x+zw-w; anchor='end'; ax = z.x+zw; }
        else { x = z.x; anchor='start'; ax = z.x; }
        y = cy-h/2;
      } else if(z.kind==='below'){ x = cx-w/2; y = c.y+c.h+(z.gap||0.8); anchor='middle'; ax = cx; }
      else if(z.kind==='above'){ x = cx-w/2; y = c.y-(z.gap||1)-h; anchor='middle'; ax = cx; }
      else if(z.kind==='left'){ x = c.x-(z.gap||1)-w; y = cy-h/2; anchor='end'; ax = c.x-(z.gap||1); }
      else { x = c.x+c.w+(z.gap||1); y = cy-h/2; anchor='start'; ax = c.x+c.w+(z.gap||1); }
      const b1 = y + sizeMm*0.78, b2 = b1 + sizeMm*lead;
      return {x, y, w, h, anchor, ax, b1, b2, pt, sizeMm, lines, bold0:wt.b0, bold1:wt.b1};
    }
    function zoneWidth(seat){
      const L = layout(); if(!L) return 40;
      const z = seat.zone, room = L.room, c = seat.chair, cx = c.x+c.w/2;
      if(z.kind==='band') return z.w*state.style.band/100;
      if(z.kind==='below' || z.kind==='above') return 2*Math.min(cx-room.x, room.x+room.w-cx)-1;
      if(z.kind==='left') return c.x-(z.gap||1)-room.x-1;
      return room.x+room.w-(c.x+c.w+(z.gap||1))-1;
    }
    function overlaps(a,b,pad){
      pad = pad==null ? 0.25 : pad;
      return !(a.x+a.w+pad<=b.x || b.x+b.w+pad<=a.x || a.y+a.h+pad<=b.y || b.y+b.h+pad<=a.y);
    }
    function ringThickness(f){
      const ty = f.ty != null ? f.ty : (f.t != null ? f.t : 6);
      const tx = f.tx != null ? f.tx : ty;
      return {tx, ty};
    }
    function ringInner(f){
      const th = ringThickness(f);
      return {x:f.x+th.tx, y:f.y+th.ty, w:Math.max(0, f.w-2*th.tx), h:Math.max(0, f.h-2*th.ty)};
    }
    function ringBars(f){
      const th = ringThickness(f);
      const inner = ringInner(f);
      if(inner.w <= 0 || inner.h <= 0) return [{x:f.x, y:f.y, w:f.w, h:f.h}];
      return [
        {x:f.x, y:f.y, w:f.w, h:th.ty},
        {x:f.x, y:f.y+f.h-th.ty, w:f.w, h:th.ty},
        {x:f.x, y:f.y+th.ty, w:th.tx, h:inner.h},
        {x:f.x+f.w-th.tx, y:f.y+th.ty, w:th.tx, h:inner.h}
      ];
    }
    function furnitureParts(f){
      if(f.collide && f.collide.length) return f.collide.map(c=>({x:c[0], y:c[1], w:c[2], h:c[3]}));
      if(f.shape === 'ring') return ringBars(f);
      return [{x:f.x, y:f.y, w:f.w, h:f.h}];
    }
    function computeWarnings(){
      const L = layout(); warnings = [];
      if(!L) return warnings;
      const pl = plan(), out = [], boxes = [];
      L.seats.forEach(s=>{
        const pid = pl[s.id]; if(!pid) return;
        const p = personById(pid); if(!p) return;
        const b = labelBox(s,p);
        boxes.push({seat:s, p, b});
        if(!p.first && !p.middle) out.push({type:'warn', seat:s.id, text:'Только фамилия — не хватает имени и отчества', name:fullName(p)});
        if(b.w > zoneWidth(s)+0.4) out.push({type:'err', seat:s.id, text:'Подпись шире колонки ('+b.w.toFixed(1)+' мм)', name:fullName(p)});
        const r = L.room;
        if(b.x<r.x-0.2 || b.x+b.w>r.x+r.w+0.2 || b.y<r.y-0.2 || b.y+b.h>r.y+r.h+0.2)
          out.push({type:'err', seat:s.id, text:'Подпись выходит за стены зала', name:fullName(p)});
      });
      for(let i=0;i<boxes.length;i++){
        for(let j=i+1;j<boxes.length;j++){
          if(overlaps(boxes[i].b, boxes[j].b, 0.2))
            out.push({type:'err', seat:boxes[i].seat.id, seat2:boxes[j].seat.id,
              text:'Подписи налезают друг на друга', name:boxes[i].p.last+' ↔ '+boxes[j].p.last});
        }
        L.furniture.forEach(f=>{
          furnitureParts(f).forEach(bar=>{
            if(overlaps(boxes[i].b, bar, 0.2))
              out.push({type:'err', seat:boxes[i].seat.id, text:'Подпись заходит на мебель', name:fullName(boxes[i].p)});
          });
        });
        L.seats.forEach(s2=>{
          if(s2.id===boxes[i].seat.id) return;
          if(overlaps(boxes[i].b, s2.chair, 0.2))
            out.push({type:'warn', seat:boxes[i].seat.id, text:'Подпись задевает соседний стул '+s2.id, name:fullName(boxes[i].p)});
        });
      }
      const seen = {};
      L.seats.forEach(s=>{
        const pid = pl[s.id]; if(!pid) return;
        const p = personById(pid); if(!p) return;
        const key = fullName(p).toLocaleLowerCase('ru-RU');
        if(seen[key]) out.push({type:'warn', seat:s.id, text:'Одинаковое ФИО уже есть на схеме', name:fullName(p)});
        else seen[key] = s.id;
      });
      const keys = new Set();
      out.forEach(w=>{
        const k = w.type+'|'+w.seat+'|'+(w.seat2||'')+'|'+w.text;
        if(!keys.has(k)){ keys.add(k); warnings.push(w); }
      });
      return warnings;
    }
    
    function snapshot(){
      return JSON.stringify({schema:SCHEMA, hallId:state.hallId, layoutId:state.layoutId,
        meta:state.meta, people:state.people, plans:state.plans, style:state.style});
    }
    function pushHistory(label){
      const snap = snapshot();
      if(hIndex>=0 && history[hIndex] && history[hIndex].snap===snap) return;
      history = history.slice(0, hIndex+1);
      history.push({snap, label:label||'Изменение'});
      if(history.length>80) history.shift();
      hIndex = history.length-1;
      scheduleSave();
    }
    function restore(snap){
      const d = JSON.parse(snap);
      state.hallId = d.hallId; state.layoutId = d.layoutId; state.meta = d.meta;
      state.people = d.people; state.plans = d.plans;
      state.style = Object.assign({}, DEFAULT_STYLE, d.style);
      validate();
    }
    function validate(){
      const pids = new Set(state.people.map(p=>p.id));
      let dropped = 0;
      Object.keys(state.plans).forEach(key=>{
        const parts = key.split('/');
        const h = halls.find(x=>x.id===parts[0]);
        const L = h && h.layouts.find(x=>x.id===parts[1]);
        const ids = new Set(L ? L.seats.map(s=>s.id) : []);
        const pl = state.plans[key];
        Object.keys(pl).forEach(sid=>{
          if(!ids.has(sid) || !pids.has(pl[sid])){ delete pl[sid]; dropped++; }
        });
      });
      if(!seatById(ui.selSeat)) ui.selSeat = null;
      if(!personById(ui.selPerson)) ui.selPerson = null;
      ui.bulk = new Set([...ui.bulk].filter(id=>pids.has(id)));
      return dropped;
    }
    function undo(){ if(hIndex<=0) return null; hIndex--; restore(history[hIndex].snap); scheduleSave(); emit('undo'); return history[hIndex+1].label; }
    function redo(){ if(hIndex>=history.length-1) return null; hIndex++; restore(history[hIndex].snap); scheduleSave(); emit('redo'); return history[hIndex].label; }
    function canUndo(){ return hIndex>0; }
    function canRedo(){ return hIndex<history.length-1; }
    function resetHistory(){ history = []; hIndex = -1; pushHistory('Начало работы'); }
    
    function scheduleSave(){
      saveState = 'saving'; emit('save-state');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(()=>{
        try{ localStorage.setItem(STORE_KEY, snapshot()); saveState = 'saved'; }
        catch(e){ saveState = 'unavailable'; }
        emit('save-state');
      }, 420);
    }
    function getSaveState(){ return saveState; }
    function loadSaved(){
      try{
        const raw = localStorage.getItem(STORE_KEY);
        if(!raw) return false;
        const d = JSON.parse(raw);
        if(!d || !Array.isArray(d.people)) return false;
        state.hallId = halls.some(h=>h.id===d.hallId) ? d.hallId : halls[0].id;
        const h = hall();
        state.layoutId = h.layouts.some(l=>l.id===d.layoutId) ? d.layoutId : h.layouts[0].id;
        state.meta = Object.assign(state.meta, d.meta||{});
        state.people = d.people.filter(p=>p&&p.id).map(p=>({id:p.id, last:p.last||'', first:p.first||'', middle:p.middle||''}));
        state.plans = d.plans || {};
        state.style = Object.assign({}, DEFAULT_STYLE, d.style||{});
        validate();
        return true;
      }catch(e){ return false; }
    }
    
    function assign(seatId, pid){
      const pl = plan(), seat = seatById(seatId), p = personById(pid);
      if(!seat || !p) return {ok:false};
      const occupant = pl[seatId];
      if(occupant===pid) return {ok:false, same:true};
      const prev = seatOfPerson(pid, pl);
      if(prev) delete pl[prev];
      if(occupant && prev) pl[prev] = occupant;
      pl[seatId] = pid;
      pushHistory('Рассадка: '+seatId); emit('assign');
      return {ok:true, swapped:!!(occupant&&prev), replaced:!!(occupant&&!prev), occupant};
    }
    function unassign(seatId){
      const pl = plan();
      if(!pl[seatId]) return false;
      delete pl[seatId];
      pushHistory('Снято место '+seatId); emit('unassign');
      return true;
    }
    function clearSeats(){
      const n = Object.keys(plan()).length;
      if(!n) return 0;
      state.plans[planKey()] = {};
      pushHistory('Очистка рассадки'); emit('clear');
      return n;
    }
    function clearPeople(){
      const n = state.people.length;
      if(!n) return 0;
      state.people = []; state.plans = {};
      ui.bulk.clear(); ui.selPerson = null; ui.selSeat = null;
      pushHistory('Очистка списка участников'); emit('people');
      return n;
    }
    function savePerson(data, id){
      let p = id ? personById(id) : null;
      if(!p){ p = {id:uid(), last:'', first:'', middle:''}; state.people.push(p); }
      p.last = data.last; p.first = data.first; p.middle = data.middle;
      pushHistory('Карточка участника'); emit('people');
      return p;
    }
    function deletePeople(ids){
      const set = new Set(ids);
      const n = state.people.filter(p=>set.has(p.id)).length;
      state.people = state.people.filter(p=>!set.has(p.id));
      for(const k in state.plans){ const pl = state.plans[k]; for(const s in pl) if(set.has(pl[s])) delete pl[s]; }
      set.forEach(id=>ui.bulk.delete(id));
      if(set.has(ui.selPerson)) ui.selPerson = null;
      pushHistory('Удаление участников'); emit('people');
      return n;
    }
    function unassignPeople(ids){
      const pl = plan(); let n = 0;
      ids.forEach(pid=>{ const s = seatOfPerson(pid, pl); if(s){ delete pl[s]; n++; } });
      if(n){ pushHistory('Массовое снятие'); emit('unassign'); }
      return n;
    }
    function setMeta(patch){ Object.assign(state.meta, patch); emit('meta'); scheduleSave(); }
    function setStyle(patch){ Object.assign(state.style, patch); emit('style'); scheduleSave(); }
    function switchHall(id){
      const h = halls.find(x=>x.id===id); if(!h) return;
      state.hallId = id; state.layoutId = h.layouts[0].id;
      state.meta.room = h.name; ui.selSeat = null;
      validate(); pushHistory('Смена зала'); emit('hall');
    }
    function switchLayout(id){
      const h = hall(); if(!h.layouts.some(l=>l.id===id)) return;
      state.layoutId = id; ui.selSeat = null;
      validate(); pushHistory('Смена расстановки'); emit('layout');
    }
    function replaceAll(data){
      state.hallId = halls.some(h=>h.id===data.hallId) ? data.hallId : halls[0].id;
      const h = hall();
      state.layoutId = h.layouts.some(l=>l.id===data.layoutId) ? data.layoutId : h.layouts[0].id;
      state.meta = Object.assign(state.meta, data.meta||{});
      state.people = (data.people||[]).map(p=>({id:p.id||uid(), last:p.last||'', first:p.first||'', middle:p.middle||''}));
      state.plans = data.plans || {};
      state.style = Object.assign({}, DEFAULT_STYLE, data.style||{});
      ui.selPerson = null; ui.selSeat = null; ui.bulk.clear();
      const dropped = validate();
      pushHistory('Проект открыт'); emit('project');
      return dropped;
    }
    function importPeople(rows, mode){
      const add = rows.map(r=>({id:uid(), last:r.last, first:r.first, middle:r.middle}));
      if(mode==='replace'){ state.people = add; state.plans = {}; ui.bulk.clear(); ui.selPerson = null; ui.selSeat = null; }
      else state.people = state.people.concat(add);
      pushHistory('Импорт списка'); emit('people');
      return add.length;
    }
    function importSeatMap(map){
      const L = layout(); if(!L) return {matched:0, created:0, unknown:0};
      const pl = plan();
      const byName = {};
      state.people.forEach(p=>{ byName[fullName(p).toLocaleLowerCase('ru-RU')] = p.id; });
      const used = new Set(); let matched = 0, created = 0, unknown = 0;
      L.seats.forEach(s=>{
        const fio = map[s.id];
        if(fio === undefined) return;
        if(!fio){ delete pl[s.id]; return; }
        const key = fio.toLocaleLowerCase('ru-RU');
        let pid = byName[key];
        if(!pid){
          const q = parseFio(fio);
          const np = {id:uid(), last:q.last, first:q.first, middle:q.middle};
          state.people.push(np); byName[key] = np.id; pid = np.id; created++;
        }
        if(used.has(pid)){ unknown++; return; }
        used.add(pid); pl[s.id] = pid; matched++;
      });
      Object.keys(map).forEach(id=>{ if(!L.seats.some(s=>s.id===id)) unknown++; });
      pushHistory('Рассадка загружена'); emit('project');
      return {matched, created, unknown};
    }
    function newScheme(){
      state.people = []; state.plans = {};
      ui.bulk.clear(); ui.selPerson = null; ui.selSeat = null;
      state.meta.title = 'Схема размещения';
      pushHistory('Новая схема'); emit('project');
    }
    
    function loadViews(){ try{ savedViews = JSON.parse(localStorage.getItem(VIEWS_KEY)||'[]') || []; }catch(e){ savedViews = []; } }
    function persistViews(){ try{ localStorage.setItem(VIEWS_KEY, JSON.stringify(savedViews)); }catch(e){} }
    function addView(v){ savedViews.push(v); if(savedViews.length>8) savedViews.shift(); persistViews(); }
    function removeView(i){ savedViews.splice(i,1); persistViews(); }
    
    window.Model = {
      MM_PER_PT, PAGE_PORTRAIT, PAGE_LANDSCAPE, SCHEMA, FONT_STACK, BLOCK_NAMES, DEFAULT_STYLE,
      state, ui, textW, parseFio, clamp, ringThickness, ringInner, ringBars, furnitureParts,
      get halls(){ return halls; },
      get warnings(){ return warnings; },
      get views(){ return savedViews; },
      setTemplates, templateInfo, cacheAssets, readCache, cacheDate,
      setDemo, demoInfo, demoFallback, applyDemo,
      subscribe, emit,
      hall, layout, page, plan, planKey, personById, seatById,
      fullName, surnameLine, givenLine, seatOfPerson, placedElsewhere,
      titleTexts, stats, visiblePeople,
      fontPt, labelBox, zoneWidth, computeWarnings,
      pushHistory, undo, redo, canUndo, canRedo, resetHistory, validate,
      loadSaved, scheduleSave, getSaveState,
      assign, unassign, clearSeats, clearPeople, savePerson, deletePeople, unassignPeople,
      setMeta, setStyle, switchHall, switchLayout, replaceAll,
      importPeople, importSeatMap, newScheme,
      loadViews, addView, removeView
    };
    })();