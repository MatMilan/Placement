/* Отрисовка листа: SVG для экрана, Canvas для выгрузки. Зум, панорамирование, подсветка.
   Размер и ориентация листа берутся из текущей расстановки (Model.page()). */
   (function(){
    "use strict";
    
    const M = window.Model;
    const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    
    let svg, wrap;
    let view = {vx:0, vy:0, scale:2};
    let fitScale = 2;
    const popSeats = new Set();
    
    function init(){ svg = document.getElementById('plan'); wrap = document.getElementById('canvasWrap'); }
    function hex2rgb(h){
      h = String(h||'#000').replace('#','');
      if(h.length===3) h = h.split('').map(c=>c+c).join('');
      const n = parseInt(h,16);
      return [(n>>16)&255,(n>>8)&255,n&255];
    }
    function mix(hex1, hex2, t){
      const a = hex2rgb(hex1), b = hex2rgb(hex2);
      return 'rgb(' + a.map((v,i)=>Math.round(v*(1-t)+b[i]*t)).join(',') + ')';
    }
    function furnLabelSize(f, box){
      let mm = Math.min(4.2, Math.max(2.4, Math.min(box.w, box.h) * 0.22));
      const max = box.w - 3;
      while(mm > 1.5 && M.textW(f.label, mm, false) > max) mm -= 0.12;
      return mm;
    }
    
    function sheetModel(forExport){
      const L = M.layout(), st = M.state.style, pl = M.plan();
      const P = M.page();
      const items = [];
      if(!L) return items;
    
      items.push({t:'rect', x:0, y:0, w:P.w, h:P.h, fill:st.paper});
      const T = M.titleTexts();
      items.push({t:'text', x:P.w/2, y:6.4, size:st.titleSize*M.MM_PER_PT, anchor:'middle', bold:true, fill:st.label, text:T.main, family:M.FONT_STACK});
      if(T.sub) items.push({t:'text', x:P.w/2, y:10.8, size:st.titleSize*0.72*M.MM_PER_PT, anchor:'middle', bold:false, fill:st.label, text:T.sub, family:M.FONT_STACK});
    
      const r = L.room;
      items.push({t:'rect', x:r.x, y:r.y, w:r.w, h:r.h, fill:'none', stroke:st.label, lw:st.stroke*1.6});
    
      if(st.windows) L.windows.forEach(w=>{
        const t = st.stroke, col = '#3d8fd6';
        if(w.side==='top' || w.side==='bottom'){
          const y = w.side==='top' ? r.y : r.y+r.h;
          items.push({t:'line', x1:w.a, y1:y, x2:w.b, y2:y, stroke:st.paper, lw:t*2.8});
          items.push({t:'line', x1:w.a, y1:y-0.7, x2:w.b, y2:y-0.7, stroke:col, lw:t*0.9});
          items.push({t:'line', x1:w.a, y1:y+0.7, x2:w.b, y2:y+0.7, stroke:col, lw:t*0.9});
          items.push({t:'line', x1:w.a, y1:y-0.7, x2:w.a, y2:y+0.7, stroke:col, lw:t*0.9});
          items.push({t:'line', x1:w.b, y1:y-0.7, x2:w.b, y2:y+0.7, stroke:col, lw:t*0.9});
        } else {
          const x = w.side==='right' ? r.x+r.w : r.x;
          items.push({t:'line', x1:x, y1:w.a, x2:x, y2:w.b, stroke:st.paper, lw:t*2.8});
          items.push({t:'line', x1:x-0.7, y1:w.a, x2:x-0.7, y2:w.b, stroke:col, lw:t*0.9});
          items.push({t:'line', x1:x+0.7, y1:w.a, x2:x+0.7, y2:w.b, stroke:col, lw:t*0.9});
          items.push({t:'line', x1:x-0.7, y1:w.a, x2:x+0.7, y2:w.a, stroke:col, lw:t*0.9});
          items.push({t:'line', x1:x-0.7, y1:w.b, x2:x+0.7, y2:w.b, stroke:col, lw:t*0.9});
        }
      });
    
      if(st.doors) L.doors.forEach(d=>{
        const len = d.b-d.a, col = '#c0392b', t = st.stroke;
        if(d.side==='bottom'){
          const y = r.y+r.h;
          items.push({t:'line', x1:d.a, y1:y, x2:d.b, y2:y, stroke:st.paper, lw:t*3});
          items.push({t:'line', x1:d.a, y1:y, x2:d.a, y2:y-len, stroke:col, lw:t});
          items.push({t:'arc', cx:d.a, cy:y, r:len, a0:-Math.PI/2, a1:0, stroke:col, lw:t*0.7, dash:[1,1]});
        } else if(d.side==='top'){
          const y = r.y;
          items.push({t:'line', x1:d.a, y1:y, x2:d.b, y2:y, stroke:st.paper, lw:t*3});
          items.push({t:'line', x1:d.a, y1:y, x2:d.a, y2:y+len, stroke:col, lw:t});
          items.push({t:'arc', cx:d.a, cy:y, r:len, a0:0, a1:Math.PI/2, stroke:col, lw:t*0.7, dash:[1,1]});
        } else if(d.side==='right'){
          const x = r.x+r.w;
          items.push({t:'line', x1:x, y1:d.a, x2:x, y2:d.b, stroke:st.paper, lw:t*3});
          items.push({t:'line', x1:x, y1:d.a, x2:x-len, y2:d.a, stroke:col, lw:t});
          items.push({t:'arc', cx:x, cy:d.a, r:len, a0:Math.PI/2, a1:Math.PI, stroke:col, lw:t*0.7, dash:[1,1]});
        } else {
          const x = r.x;
          items.push({t:'line', x1:x, y1:d.a, x2:x, y2:d.b, stroke:st.paper, lw:t*3});
          items.push({t:'line', x1:x, y1:d.a, x2:x+len, y2:d.a, stroke:col, lw:t});
          items.push({t:'arc', cx:x, cy:d.a, r:len, a0:0, a1:Math.PI/2, stroke:col, lw:t*0.7, dash:[1,1]});
        }
      });
    
      L.furniture.forEach(f=>{
        let labelBoxRect = {x:f.x, y:f.y, w:f.w, h:f.h};
        if(f.shape==='ellipse'){
          items.push({t:'ellipse', cx:f.x+f.w/2, cy:f.y+f.h/2, rx:f.w/2, ry:f.h/2, fill:st.furn, stroke:st.label, lw:st.stroke});
        } else if(f.shape==='ring'){
          const th = M.ringThickness(f);
          const rad = f.r != null ? f.r : 3;
          items.push({t:'round', x:f.x, y:f.y, w:f.w, h:f.h, r:rad, fill:st.furn, stroke:st.label, lw:st.stroke});
          const inner = M.ringInner(f);
          if(inner.w > 0 && inner.h > 0){
            items.push({t:'round', x:inner.x, y:inner.y, w:inner.w, h:inner.h,
              r:Math.max(0, rad - Math.min(th.tx, th.ty)), fill:st.paper, stroke:st.label, lw:st.stroke});
            labelBoxRect = {x:f.x, y:f.y, w:f.w, h:th.ty};
          }
        } else {
          const rad = f.shape==='capsule' ? Math.min(f.w,f.h)/2 : (f.r != null ? f.r : 1.2);
          items.push({t:'round', x:f.x, y:f.y, w:f.w, h:f.h, r:rad, fill:st.furn, stroke:st.label, lw:st.stroke});
        }
        if(f.label && st.furnLabels){
          const mm = furnLabelSize(f, labelBoxRect);
          const lx = f.labelAt ? f.labelAt[0] : labelBoxRect.x + labelBoxRect.w/2;
          const ly = f.labelAt ? f.labelAt[1] : labelBoxRect.y + labelBoxRect.h/2 + mm*0.36;
          items.push({t:'text', x:lx, y:ly, size:mm, anchor:'middle', bold:false, fill:st.label, text:f.label, family:M.FONT_STACK});
        }
      });
    
      const bad = new Set();
      M.warnings.forEach(w=>{ if(w.type==='err'){ bad.add(w.seat); if(w.seat2) bad.add(w.seat2); } });
    
      L.seats.forEach(s=>{
        const c = s.chair, pid = pl[s.id], p = pid ? M.personById(pid) : null, occ = !!p;
        const inset = Math.min(c.w,c.h)*0.22;
        const item = {
          t:'seat', id:s.id, occ,
          selected: !forExport && M.ui.selSeat===s.id,
          bad: !forExport && bad.has(s.id),
          pop: !forExport && popSeats.has(s.id),
          parts:[
            {t:'round', cls:'chair-out', x:c.x, y:c.y, w:c.w, h:c.h, r:Math.min(c.w,c.h)*0.32,
             fill: occ ? mix(st.accent, st.paper, .78) : st.paper, stroke:st.label, lw:st.stroke},
            {t:'round', cls:'chair-in', x:c.x+inset, y:c.y+inset, w:c.w-inset*2, h:c.h-inset*2, r:Math.min(c.w,c.h)*0.2,
             fill: occ ? mix(st.accent, st.paper, .40) : st.furn, stroke:'none', lw:0}
          ]
        };
        if(st.ids && !forExport){
          item.parts.push({t:'text', x:c.x+c.w/2, y:c.y+c.h/2+0.95, size:2.6, anchor:'middle', bold:true,
            fill:'#5f6f79', text:String(parseInt(s.id.replace(/\D/g,''),10)), family:'monospace'});
        }
        if(p){
          const b = M.labelBox(s,p);
          if(st.frames || (!forExport && bad.has(s.id))){
            item.parts.push({t:'round', cls:'lbl-bg', x:b.x-0.7, y:b.y-0.5, w:b.w+1.4, h:b.h+1, r:0.8,
              fill:'none', stroke:'rgba(0,0,0,.28)', lw:st.stroke*0.5});
          }
          item.parts.push({t:'text', x:b.ax, y:b.b1, size:b.sizeMm, anchor:b.anchor, bold:b.bold0, fill:st.label, text:b.lines[0], family:M.FONT_STACK});
          if(b.lines[1]) item.parts.push({t:'text', x:b.ax, y:b.b2, size:b.sizeMm, anchor:b.anchor, bold:b.bold1, fill:st.label, text:b.lines[1], family:M.FONT_STACK});
          const x0 = Math.min(c.x,b.x)-0.6, y0 = Math.min(c.y,b.y)-0.6;
          item.hit = {x:x0, y:y0, w:Math.max(c.x+c.w,b.x+b.w)-x0+0.6, h:Math.max(c.y+c.h,b.y+b.h)-y0+0.6};
        } else {
          item.hit = {x:c.x-1.4, y:c.y-1.4, w:c.w+2.8, h:c.h+2.8};
        }
        items.push(item);
      });
      return items;
    }
    
    function toSvg(it){
      switch(it.t){
        case 'rect':
          return '<rect x="'+it.x+'" y="'+it.y+'" width="'+it.w+'" height="'+it.h+'" fill="'+it.fill+'"' +
            (it.stroke ? ' stroke="'+it.stroke+'" stroke-width="'+it.lw+'"' : '') + '/>';
        case 'round':
          return '<rect' + (it.cls ? ' class="'+it.cls+'"' : '') + ' x="'+it.x.toFixed(2)+'" y="'+it.y.toFixed(2)+
            '" width="'+it.w.toFixed(2)+'" height="'+it.h.toFixed(2)+'" rx="'+it.r.toFixed(2)+'" fill="'+it.fill+'"' +
            (it.stroke && it.stroke!=='none' ? ' stroke="'+it.stroke+'" stroke-width="'+it.lw+'"' : '') + '/>';
        case 'ellipse':
          return '<ellipse cx="'+it.cx+'" cy="'+it.cy+'" rx="'+it.rx+'" ry="'+it.ry+'" fill="'+it.fill+'" stroke="'+it.stroke+'" stroke-width="'+it.lw+'"/>';
        case 'line':
          return '<line x1="'+it.x1+'" y1="'+it.y1+'" x2="'+it.x2+'" y2="'+it.y2+'" stroke="'+it.stroke+'" stroke-width="'+it.lw+'" stroke-linecap="butt"/>';
        case 'arc': {
          const x0 = it.cx+it.r*Math.cos(it.a0), y0 = it.cy+it.r*Math.sin(it.a0);
          const x1 = it.cx+it.r*Math.cos(it.a1), y1 = it.cy+it.r*Math.sin(it.a1);
          return '<path d="M'+x0.toFixed(2)+' '+y0.toFixed(2)+' A'+it.r.toFixed(2)+' '+it.r.toFixed(2)+' 0 0 1 '+x1.toFixed(2)+' '+y1.toFixed(2)+
            '" fill="none" stroke="'+it.stroke+'" stroke-width="'+it.lw+'"' + (it.dash ? ' stroke-dasharray="'+it.dash.join(' ')+'"' : '') + '/>';
        }
        case 'text':
          return '<text x="'+it.x.toFixed(2)+'" y="'+it.y.toFixed(2)+'" font-size="'+it.size.toFixed(3)+
            '" text-anchor="'+it.anchor+'" font-family=\''+it.family+'\'' + (it.bold?' font-weight="700"':'') +
            ' fill="'+it.fill+'" xml:space="preserve">'+esc(it.text)+'</text>';
        case 'seat': {
          const cls = ['seat'];
          if(it.occ) cls.push('occ');
          if(it.selected) cls.push('selected');
          if(it.bad) cls.push('bad');
          if(it.pop) cls.push('pop');
          let inner = it.parts.map(toSvg).join('');
          inner += '<rect class="hit" x="'+it.hit.x.toFixed(2)+'" y="'+it.hit.y.toFixed(2)+'" width="'+it.hit.w.toFixed(2)+'" height="'+it.hit.h.toFixed(2)+'"/>';
          return '<g class="'+cls.join(' ')+'" data-seat="'+it.id+'">'+inner+'</g>';
        }
      }
      return '';
    }
    function sheetSvg(forExport){ return sheetModel(forExport).map(toSvg).join(''); }
    
    function render(){
      if(!svg) return;
      const P = M.page();
      svg.innerHTML =
        '<g class="sheet-shadow"><rect x="0" y="0" width="'+P.w+'" height="'+P.h+'" fill="'+M.state.style.paper+'"/></g>' +
        sheetSvg(false) +
        '<rect class="sheet-edge" x="0.15" y="0.15" width="'+(P.w-0.3)+'" height="'+(P.h-0.3)+'"/>';
      applyView();
    }
    function markPop(seatId){ popSeats.add(seatId); setTimeout(()=>popSeats.delete(seatId), 520); }
    function highlight(seatId){
      if(!svg) return;
      svg.querySelectorAll('.seat.target').forEach(n=>n.classList.remove('target'));
      if(seatId){ const el = svg.querySelector('[data-seat="'+seatId+'"]'); if(el) el.classList.add('target'); }
    }
    
    function rect(){ return wrap.getBoundingClientRect(); }
    function applyView(){
      const r = rect();
      const w = Math.max(1, r.width), h = Math.max(1, r.height);
      svg.setAttribute('viewBox', view.vx.toFixed(3)+' '+view.vy.toFixed(3)+' '+(w/view.scale).toFixed(3)+' '+(h/view.scale).toFixed(3));
      const pct = Math.round(view.scale/fitScale*100);
      const zv = document.getElementById('zoomVal'), zr = document.getElementById('zoomRange');
      if(zv) zv.textContent = pct+'%';
      if(zr && document.activeElement !== zr) zr.value = M.clamp(pct,30,420);
    }
    function computeFit(){
      const r = rect();
      const P = M.page();
      const w = Math.max(1, r.width), h = Math.max(1, r.height);
      fitScale = Math.min(w/P.w, h/P.h)*0.94;
      return {w,h};
    }
    function fit(){
      const d = computeFit();
      const P = M.page();
      view.scale = fitScale;
      view.vx = P.w/2 - d.w/(2*view.scale);
      view.vy = P.h/2 - d.h/(2*view.scale);
      applyView();
    }
    function zoomAt(px, py, factor){
      const mx = view.vx + px/view.scale, my = view.vy + py/view.scale;
      const ns = M.clamp(view.scale*factor, fitScale*0.3, fitScale*4.2);
      view.scale = ns; view.vx = mx - px/ns; view.vy = my - py/ns;
      applyView();
    }
    function zoomCenter(f){ const r = rect(); zoomAt(r.width/2, r.height/2, f); }
    function setZoomPercent(p){ const r = rect(); zoomAt(r.width/2, r.height/2, (fitScale*p/100)/view.scale); }
    function panBy(dx, dy){ view.vx -= dx/view.scale; view.vy -= dy/view.scale; applyView(); }
    function focusSeat(id){
      const s = M.seatById(id); if(!s) return;
      const r = rect();
      view.scale = Math.max(view.scale, fitScale*1.7);
      view.vx = s.chair.x+s.chair.w/2 - r.width/(2*view.scale);
      view.vy = s.chair.y+s.chair.h/2 - r.height/(2*view.scale);
      applyView();
    }
    function seatAt(x, y){
      const el = document.elementFromPoint(x, y);
      const g = el && el.closest ? el.closest('[data-seat]') : null;
      return g ? g.getAttribute('data-seat') : null;
    }
    function onResize(){
      const r = rect();
      if(r.width < 2 || r.height < 2) return;
      const cx = view.vx + r.width/(2*view.scale), cy = view.vy + r.height/(2*view.scale);
      const old = fitScale;
      computeFit();
      view.scale = view.scale * (fitScale/old);
      view.vx = cx - r.width/(2*view.scale);
      view.vy = cy - r.height/(2*view.scale);
      applyView();
    }
    
    function roundPath(ctx,x,y,w,h,r){
      r = Math.min(r, w/2, h/2);
      ctx.beginPath();
      ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
      ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
      ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
      ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
    }
    function drawItem(ctx, it){
      switch(it.t){
        case 'rect':
          if(it.fill && it.fill!=='none'){ ctx.fillStyle = it.fill; ctx.fillRect(it.x,it.y,it.w,it.h); }
          if(it.stroke){ ctx.strokeStyle = it.stroke; ctx.lineWidth = it.lw; ctx.strokeRect(it.x,it.y,it.w,it.h); }
          break;
        case 'round':
          roundPath(ctx,it.x,it.y,it.w,it.h,it.r);
          if(it.fill && it.fill!=='none'){ ctx.fillStyle = it.fill; ctx.fill(); }
          if(it.stroke && it.stroke!=='none'){ ctx.strokeStyle = it.stroke; ctx.lineWidth = it.lw; ctx.stroke(); }
          break;
        case 'ellipse':
          ctx.beginPath(); ctx.ellipse(it.cx,it.cy,it.rx,it.ry,0,0,Math.PI*2);
          ctx.fillStyle = it.fill; ctx.fill(); ctx.strokeStyle = it.stroke; ctx.lineWidth = it.lw; ctx.stroke();
          break;
        case 'line':
          ctx.beginPath(); ctx.moveTo(it.x1,it.y1); ctx.lineTo(it.x2,it.y2);
          ctx.strokeStyle = it.stroke; ctx.lineWidth = it.lw; ctx.setLineDash([]); ctx.stroke();
          break;
        case 'arc':
          ctx.beginPath(); ctx.arc(it.cx,it.cy,it.r,it.a0,it.a1);
          ctx.strokeStyle = it.stroke; ctx.lineWidth = it.lw; ctx.setLineDash(it.dash||[]); ctx.stroke(); ctx.setLineDash([]);
          break;
        case 'text':
          ctx.font = (it.bold?'700 ':'400 ') + it.size.toFixed(3) + 'px ' + it.family;
          ctx.fillStyle = it.fill; ctx.textBaseline = 'alphabetic';
          ctx.textAlign = it.anchor==='middle' ? 'center' : it.anchor==='end' ? 'right' : 'left';
          ctx.fillText(it.text, it.x, it.y);
          break;
        case 'seat': it.parts.forEach(p=>drawItem(ctx,p)); break;
      }
    }
    function renderCanvas(dpi){
      const P = M.page();
      const cv = document.createElement('canvas');
      cv.width = Math.round(P.w/25.4*dpi);
      cv.height = Math.round(P.h/25.4*dpi);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = M.state.style.paper;
      ctx.fillRect(0,0,cv.width,cv.height);
      ctx.setTransform(dpi/25.4,0,0,dpi/25.4,0,0);
      ctx.lineJoin = 'round';
      sheetModel(true).forEach(it=>drawItem(ctx,it));
      return cv;
    }
    function printSvg(){
      const P = M.page();
      return '<svg xmlns="http://www.w3.org/2000/svg" width="'+P.w+'mm" height="'+P.h+'mm" viewBox="0 0 '+P.w+' '+P.h+'">' + sheetSvg(true) + '</svg>';
    }
    
    window.View = {
      init, render, markPop, highlight, sheetSvg, printSvg, renderCanvas,
      fit, zoomAt, zoomCenter, setZoomPercent, panBy, focusSeat, seatAt, onResize, rect,
      get scale(){ return view.scale; },
      get fitScale(){ return fitScale; },
      get wrap(){ return wrap; },
      get svg(){ return svg; }
    };
    })();