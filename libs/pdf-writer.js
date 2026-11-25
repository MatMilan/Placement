/* Минимальный генератор PDF без зависимостей: одна страница A4 (книжная или альбомная)
   с растровым листом нужного разрешения. */
   (function(){
    "use strict";
    const A4 = {w:595.2756, h:841.8898};
    
    function fromJpeg(jpegBytes, wPx, hPx, landscape){
      const pw = landscape ? A4.h : A4.w;
      const ph = landscape ? A4.w : A4.h;
      const enc = new TextEncoder();
      const chunks = []; let len = 0; const off = [];
      const push = d => { const b = (typeof d === 'string') ? enc.encode(d) : d; chunks.push(b); len += b.length; };
      push('%PDF-1.4\n');
      push(new Uint8Array([0x25,0xE2,0xE3,0xCF,0xD3,0x0A]));
      off[1] = len; push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
      off[2] = len; push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
      off[3] = len; push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph +
        '] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\nendobj\n');
      off[4] = len; push('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + wPx + ' /Height ' + hPx +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpegBytes.length + ' >>\nstream\n');
      push(jpegBytes); push('\nendstream\nendobj\n');
      const cs = 'q\n' + pw + ' 0 0 ' + ph + ' 0 0 cm\n/Im0 Do\nQ\n';
      off[5] = len; push('5 0 obj\n<< /Length ' + cs.length + ' >>\nstream\n' + cs + 'endstream\nendobj\n');
      const xref = len;
      let x = 'xref\n0 6\n0000000000 65535 f \n';
      for(let i=1;i<=5;i++) x += String(off[i]).padStart(10,'0') + ' 00000 n \n';
      push(x);
      push('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
      return new Blob(chunks, {type:'application/pdf'});
    }
    function b64ToBytes(b64){
      const bin = atob(b64), out = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    function fromCanvas(canvas, quality, landscape){
      const url = canvas.toDataURL('image/jpeg', quality == null ? 0.95 : quality);
      return fromJpeg(b64ToBytes(url.slice(url.indexOf(',') + 1)), canvas.width, canvas.height, !!landscape);
    }
    window.PDFWriter = {fromJpeg, fromCanvas, b64ToBytes, A4};
    })();
