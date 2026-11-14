/* Import (.txt, .md, .docx, .rtf, backup .json) and export helpers. */
(function () {
  'use strict';

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }

  /* Minimal zip reader: returns the bytes of one named entry. */
  async function unzipEntry(buf, name) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a valid .docx file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const td = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const fname = td.decode(u8.subarray(p + 46, p + 46 + nlen));
      if (fname === name) {
        const ln = dv.getUint16(off + 26, true), lx = dv.getUint16(off + 28, true);
        const data = u8.subarray(off + 30 + ln + lx, off + 30 + ln + lx + csize);
        return method === 0 ? data : inflateRaw(data);
      }
      p += 46 + nlen + xlen + clen;
    }
    throw new Error('No document text found in file');
  }

  async function docxToText(buf) {
    const xml = new TextDecoder().decode(await unzipEntry(buf, 'word/document.xml'));
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const out = [];
    for (const p of doc.getElementsByTagNameNS(W, 'p')) {
      let line = '';
      const walk = (node) => {
        for (const c of node.childNodes) {
          if (c.nodeType !== 1) continue;
          if (c.namespaceURI === W && c.localName === 't') line += c.textContent;
          else if (c.namespaceURI === W && c.localName === 'tab') line += ' ';
          else if (c.namespaceURI === W && (c.localName === 'br' || c.localName === 'cr')) line += '\n';
          else if (c.namespaceURI === W && (c.localName === 'del' || c.localName === 'instrText')) continue;
          else walk(c);
        }
      };
      walk(p);
      out.push(line);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function rtfToText(rtf) {
    return rtf
      .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict|\*)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '')
      .replace(/\\par[d]?\b ?/g, '\n').replace(/\\line\b ?/g, '\n').replace(/\\tab\b ?/g, ' ')
      .replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u(-?\d+)\??/g, (m, d) => String.fromCharCode((+d + 65536) % 65536))
      .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* Returns {kind:'script', title, text} or {kind:'backup', scripts}. */
  async function readFile(file) {
    const name = file.name || 'Untitled';
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
    const title = name.replace(/\.[a-z0-9]+$/i, '');
    if (ext === 'docx' || /wordprocessingml/.test(file.type)) return { kind: 'script', title, text: await docxToText(await file.arrayBuffer()) };
    if (ext === 'json') {
      const data = JSON.parse(await file.text());
      if (data && data.app === 'cuefollow' && Array.isArray(data.scripts)) return { kind: 'backup', scripts: data.scripts };
      throw new Error('Not a CueFollow backup file');
    }
    if (ext === 'rtf') return { kind: 'script', title, text: rtfToText(await file.text()) };
    if (['txt', 'md', 'text', 'markdown', ''].includes(ext) || /^text\//.test(file.type)) return { kind: 'script', title, text: (await file.text()).trim() };
    if (ext === 'doc' || ext === 'pdf' || ext === 'gdoc') throw new Error('.' + ext + ' is not supported. Save it as .docx or .txt first.');
    throw new Error('Unsupported file type: .' + ext);
  }

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  }

  /* Share sheet first (reaches the OneDrive and Google Drive apps on Android); returns 'shared' | 'cancelled' | 'unsupported'. */
  async function share(blob, filename, title) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: title || filename });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
    return 'unsupported';
  }

  const safeName = (s) => (String(s || 'script').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'script');

  window.CueFiles = { readFile, docxToText, rtfToText, download, share, safeName };
})();
