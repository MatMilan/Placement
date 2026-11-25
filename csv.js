/* Разбор CSV: кодировка, разделитель, ФИО одной колонкой, рассадка, предпросмотр. */
(function(){
"use strict";

const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function decodeBuffer(buf){
  try{ return {text:new TextDecoder('utf-8',{fatal:true}).decode(buf), enc:'UTF-8'}; }
  catch(e){
    try{ return {text:new TextDecoder('windows-1251').decode(buf), enc:'Windows-1251'}; }
    catch(e2){ return {text:new TextDecoder().decode(buf), enc:'UTF-8 (замена)'}; }
  }
}
function splitLine(line, d){
  const out = []; let cur = '', q = false;
  for(let i=0;i<line.length;i++){
    const ch = line[i];
    if(q){
      if(ch === '"'){ if(line[i+1] === '"'){ cur += '"'; i++; } else q = false; }
      else cur += ch;
    }
    else if(ch === '"') q = true;
    else if(ch === d){ out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s=>s.trim());
}
function detectDelim(lines){
  const cand = [';', ',', '\t'];
  let best = ';', score = 0;
  cand.forEach(d=>{
    const s = lines.slice(0,12).reduce((a,l)=>a + (l.split(d).length-1), 0);
    if(s > score){ score = s; best = d; }
  });
  return best;
}
function parsePeople(text){
  const clean = String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const lines = clean.split('\n').filter(l=>l.trim().length);
  if(!lines.length) return {rows:[], delim:';', skipped:0};
  const d = detectDelim(lines);
  let start = 0;
  const first = lines[0].trim();
  if(/^фамилия\s+имя\s+отчество$/i.test(first)) start = 1;
  else if(/^seat_id/i.test(first)) start = 1;
  else if(/^(фамилия|фио|name|участник|участники)\s*[;,]?\s*(имя\s*[;,]?\s*)?(отчество)?$/i.test(first)) start = 1;

  const rows = []; let skipped = 0;
  for(let i=start;i<lines.length;i++){
    const cells = splitLine(lines[i], d).filter(c=>c !== '');
    if(!cells.length){ skipped++; continue; }
    let p;
    if(cells.length >= 3) p = {last:cells[0], first:cells[1], middle:cells.slice(2).join(' ')};
    else if(cells.length === 2){
      const q = Model.parseFio(cells[0]);
      p = (q.first || q.middle) ? q : {last:cells[0], first:cells[1], middle:''};
    }
    else p = Model.parseFio(cells[0]);
    p.last = (p.last||'').trim(); p.first = (p.first||'').trim(); p.middle = (p.middle||'').trim();
    if(!p.last){ skipped++; continue; }
    rows.push(p);
  }
  return {rows, delim: d === '\t' ? 'табуляция' : d, skipped};
}
function namesFromBuffer(buf){
  const {text} = decodeBuffer(buf);
  return parsePeople(text).rows.map(r=>[r.last,r.first,r.middle].filter(Boolean).join(' ')).filter(Boolean);
}
function parseSeats(text){
  const clean = String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const lines = clean.split('\n').filter(l=>l.trim().length);
  if(!lines.length || !/^seat_id/i.test(lines[0].trim())) return null;
  const d = detectDelim(lines);
  const map = {};
  for(let i=1;i<lines.length;i++){
    const c = splitLine(lines[i], d);
    const id = (c[0]||'').trim();
    if(!id) continue;
    map[id] = (c[1]||'').trim();
  }
  return map;
}
function cell(v){
  v = String(v==null?'':v);
  return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v;
}
function peopleCsv(people){
  return '\uFEFF' + ['Фамилия Имя Отчество'].concat(people.map(p=>cell(Model.fullName(p)))).join('\r\n');
}
function seatsCsv(layout, plan, personById){
  const rows = ['seat_id;ФИО'];
  layout.seats.forEach(s=>{
    const p = plan[s.id] ? personById(plan[s.id]) : null;
    rows.push(cell(s.id) + ';' + cell(p ? Model.fullName(p) : ''));
  });
  return '\uFEFF' + rows.join('\r\n');
}
function previewModal(opts){
  const {rows, enc, name, delim, onApply, onClose} = opts;
  const scrim = document.getElementById('modalScrim');
  const modal = document.getElementById('modal');
  const bad = rows.filter(r=>!r.first).length;
  const preview = rows.slice(0,8).map((r,i)=>
    '<tr class="' + (r.first?'':'bad') + '"><td class="idx">' + (i+1) + '</td><td>' + esc(r.last) +
    '</td><td>' + esc(r.first) + '</td><td>' + esc(r.middle) + '</td></tr>').join('');
  modal.innerHTML =
    '<div class="modal-head"><h2>Проверьте разбор списка</h2><button class="btn icon ghost" data-close>×</button></div>' +
    '<div class="modal-body">' +
      '<div class="meta-grid">' +
        '<div class="meta-box"><i>Файл</i><b style="font-size:12px;word-break:break-all">' + esc(name) + '</b></div>' +
        '<div class="meta-box"><i>Кодировка</i><b style="font-size:13px">' + esc(enc) + '</b></div>' +
        '<div class="meta-box"><i>Разделитель</i><b style="font-size:13px">' + esc(delim) + '</b></div>' +
        '<div class="meta-box"><i>Найдено ФИО</i><b>' + rows.length + '</b></div>' +
      '</div>' +
      (bad ? '<div class="warnitem" style="margin-bottom:12px;cursor:default"><b>!</b><span>' + bad +
        ' строк без имени — они будут подсвечены, вы сможете дополнить их вручную.</span></div>' : '') +
      '<table class="preview"><thead><tr><th></th><th>Фамилия</th><th>Имя</th><th>Отчество</th></tr></thead><tbody>' +
      preview + '</tbody></table>' +
      (rows.length > 8 ? '<div style="font-size:11.5px;color:var(--txt-mute);margin-top:10px">…и ещё ' + (rows.length-8) + ' строк</div>' : '') +
    '</div>' +
    '<div class="modal-foot">' +
      '<button class="btn ghost" data-close>Отмена</button>' +
      '<button class="btn" data-mode="append">Добавить к списку</button>' +
      '<button class="btn primary" data-mode="replace">Заменить список</button>' +
    '</div>';
  scrim.classList.add('on');
  const close = ()=>{ scrim.classList.remove('on'); if(onClose) onClose(); };
  modal.querySelectorAll('[data-close]').forEach(b=>b.onclick = close);
  modal.querySelectorAll('[data-mode]').forEach(b=>b.onclick = ()=>{ onApply(b.dataset.mode); close(); });
  scrim.onclick = e=>{ if(e.target === scrim) close(); };
}

window.CSV = {decodeBuffer, splitLine, detectDelim, parsePeople, parseSeats, namesFromBuffer,
  peopleCsv, seatsCsv, previewModal};
})();