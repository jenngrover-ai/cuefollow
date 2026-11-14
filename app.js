/* CueFollow: personal voice-tracking teleprompter. All data stays on the device unless you export it. */
(function () {
  'use strict';
  const VERSION = '1.0.0';
  const $ = (id) => document.getElementById(id);
  const { parseScript, vocab, Tracker } = window.CueTracker;

  /* ---------- storage ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Could not save: storage is full or blocked'); return false; } },
  };
  const DEFAULTS = {
    font: 44, line: 1.35, margin: 6, theme: 'white', align: 'left', mirror: 'none', read: 30, showLine: true, dim: true,
    mode: 'voice', wpm: 140, count: 3, engine: 'device', lang: 'en-US',
    facing: 'user', quality: '1080', area: 45, shade: 55, audioOnly: false, awake: true, full: true,
  };
  let settings = Object.assign({}, DEFAULTS, store.get('cf.settings', {}));
  let scripts = store.get('cf.scripts', null);
  if (!scripts) {
    scripts = [{
      id: uid(), title: 'Welcome to CueFollow', updated: Date.now(),
      text: 'Welcome to CueFollow. This is a sample script you can use to test voice tracking.\n\n' +
        'Press play, wait for the countdown, and read this out loud at your normal pace. The highlight follows the words you say.\n\n' +
        '[Pause here and say something that is not in the script.]\n\n' +
        'When you go off script, the text holds its place and waits. When you come back, it picks up again from where you are reading.\n\n' +
        'You can skip ahead a sentence or two and the highlight will catch up. Double tap any word to move the starting point there.\n\n' +
        'That is the end of the sample. Delete it whenever you like.',
    }];
    store.set('cf.scripts', scripts);
  }
  const saveScripts = () => store.set('cf.scripts', scripts);
  const saveSettings = () => store.set('cf.settings', settings);
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  const wordCount = (t) => (t.trim().match(/\S+/g) || []).length;
  function fmtTime(sec) { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }

  /* ---------- small UI helpers ---------- */
  let toastTimer;
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3200);
  }
  function ask(title, body, buttons) {
    return new Promise((resolve) => {
      $('dTitle').textContent = title; $('dBody').textContent = body || '';
      const box = $('dBtns'); box.innerHTML = '';
      buttons.forEach((b, i) => {
        const el = document.createElement('button');
        el.textContent = b.label; if (b.cls) el.className = b.cls;
        el.onclick = () => { $('dialog').hidden = true; resolve(i); };
        box.appendChild(el);
      });
      $('dialog').hidden = false;
    });
  }
  function show(id) { ['library', 'editor'].forEach((s) => { $(s).hidden = s !== id; }); }

  /* ---------- library ---------- */
  function renderLibrary() {
    const ul = $('scriptList'); ul.innerHTML = '';
    if (!scripts.length) {
      const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No scripts yet. Create one or open a file.'; ul.appendChild(li); return;
    }
    scripts.slice().sort((a, b) => b.updated - a.updated).forEach((s) => {
      const li = document.createElement('li');
      const b = document.createElement('b'); b.textContent = s.title || 'Untitled';
      const n = wordCount(s.text);
      const sp = document.createElement('span');
      sp.textContent = n + ' words · about ' + fmtTime(n / settings.wpm * 60) + ' · ' + new Date(s.updated).toLocaleDateString();
      li.append(b, sp); li.onclick = () => openEditor(s.id); ul.appendChild(li);
    });
  }
  $('btnNew').onclick = () => { const s = { id: uid(), title: '', text: '', updated: Date.now() }; scripts.push(s); saveScripts(); openEditor(s.id); };
  $('btnImport').onclick = () => $('fileInput').click();
  $('fileInput').onchange = async (ev) => {
    const files = Array.from(ev.target.files || []); ev.target.value = '';
    let added = 0, last = null;
    for (const f of files) {
      try {
        const r = await window.CueFiles.readFile(f);
        if (r.kind === 'backup') {
          r.scripts.forEach((b) => {
            if (!b || typeof b.text !== 'string') return;
            const existing = scripts.find((s) => s.id === b.id);
            if (existing) { if ((b.updated || 0) > existing.updated) Object.assign(existing, b); }
            else scripts.push({ id: b.id || uid(), title: String(b.title || 'Untitled'), text: b.text, updated: b.updated || Date.now() });
            added++;
          });
        } else {
          if (!r.text) throw new Error('"' + f.name + '" has no readable text');
          last = { id: uid(), title: r.title, text: r.text, updated: Date.now() }; scripts.push(last); added++;
        }
      } catch (e) { toast(e.message || 'Could not open ' + f.name, 5000); }
    }
    if (added) { saveScripts(); renderLibrary(); toast(added + (added === 1 ? ' script added' : ' scripts added')); if (files.length === 1 && last) openEditor(last.id); }
  };
  $('btnBackup').onclick = async () => {
    const blob = new Blob([JSON.stringify({ app: 'cuefollow', version: 1, exported: new Date().toISOString(), scripts }, null, 1)], { type: 'application/json' });
    const name = 'cuefollow-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    const r = await window.CueFiles.share(blob, name, 'CueFollow backup');
    if (r === 'unsupported') { window.CueFiles.download(blob, name); toast('Backup saved to Downloads'); }
  };

  /* ---------- editor ---------- */
  let current = null, saveTimer;
  function openEditor(id) {
    current = scripts.find((s) => s.id === id); if (!current) return;
    $('edTitle').value = current.title; $('edText').value = current.text; updateMeta(); show('editor');
  }
  function updateMeta() {
    const n = wordCount($('edText').value);
    $('edMeta').textContent = n + ' words · about ' + fmtTime(n / settings.wpm * 60) + ' at ' + settings.wpm + ' wpm · saved on this device';
  }
  function commitEdit() {
    if (!current) return;
    const title = $('edTitle').value.trim(), text = $('edText').value;
    if (title === current.title && text === current.text) return;
    current.title = title; current.text = text; current.updated = Date.now(); saveScripts();
  }
  ['edTitle', 'edText'].forEach((id) => $(id).addEventListener('input', () => { updateMeta(); clearTimeout(saveTimer); saveTimer = setTimeout(commitEdit, 500); }));
  $('edBack').onclick = () => {
    commitEdit();
    if (current && !current.title && !current.text.trim()) { scripts = scripts.filter((s) => s !== current); saveScripts(); }
    current = null; renderLibrary(); show('library');
  };
  $('edDelete').onclick = async () => {
    const i = await ask('Delete this script?', 'This removes it from this device. Copies you saved to the cloud are not affected.', [{ label: 'Delete', cls: 'danger' }, { label: 'Cancel' }]);
    if (i !== 0) return;
    scripts = scripts.filter((s) => s !== current); saveScripts(); current = null; renderLibrary(); show('library');
  };
  $('edShare').onclick = async () => {
    commitEdit();
    const name = window.CueFiles.safeName(current.title || 'script') + '.txt';
    const blob = new Blob([current.text], { type: 'text/plain' });
    const r = await window.CueFiles.share(blob, name, current.title);
    if (r === 'unsupported') { window.CueFiles.download(blob, name); toast('Saved to Downloads as ' + name); }
  };
  $('edPrompt').onclick = () => { commitEdit(); openPrompter(false); };
  $('edRecord').onclick = () => { commitEdit(); openPrompter(true); };

  /* ---------- settings ---------- */
  const BIND = [
    ['sFont', 'font', 'oFont', (v) => v + ' px'], ['sLine', 'line', 'oLine', (v) => (+v).toFixed(2)], ['sMargin', 'margin', 'oMargin', (v) => v + '%'],
    ['sTheme', 'theme'], ['sAlign', 'align'], ['sMirror', 'mirror'], ['sRead', 'read', 'oRead', (v) => v + '% from top'],
    ['sShowLine', 'showLine'], ['sDim', 'dim'], ['sMode', 'mode'], ['sWpm', 'wpm', 'oWpm', (v) => v], ['sCount', 'count', 'oCount', (v) => v + ' s'],
    ['sEngine', 'engine'], ['sLang', 'lang'], ['sFacing', 'facing'], ['sQuality', 'quality'], ['sArea', 'area', 'oArea', (v) => v + '%'],
    ['sShade', 'shade', 'oShade', (v) => v + '%'], ['sAudioOnly', 'audioOnly'], ['sAwake', 'awake'], ['sFull', 'full'],
  ];
  function fillSettings() {
    BIND.forEach(([id, key, out, fmt]) => {
      const el = $(id);
      if (el.type === 'checkbox') el.checked = !!settings[key]; else el.value = settings[key];
      if (out) $(out).textContent = fmt(settings[key]);
    });
    $('about').textContent = 'CueFollow ' + VERSION + '. Scripts and settings are stored only on this device.';
  }
  BIND.forEach(([id, key, out, fmt]) => {
    const el = $(id);
    const handler = () => {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'range') v = +v;
      if (key === 'lang') v = v.trim() || 'en-US';
      settings[key] = v; saveSettings();
      if (out) $(out).textContent = fmt(v);
      if (P.open) applyPrompterSettings(key);
    };
    el.addEventListener('input', handler); el.addEventListener('change', handler);
  });
  function openSettings() { fillSettings(); $('settings').hidden = false; }
  $('btnSettings').onclick = openSettings;
  $('pSettings').onclick = () => { pause(); openSettings(); };
  $('setClose').onclick = () => { $('settings').hidden = true; if (!P.open) { renderLibrary(); if (current) updateMeta(); } };

  /* ---------- prompter ---------- */
  const P = { open: false, camera: false, mode: 'voice', playing: false, parsed: null, tracker: null, els: [], shownTok: 0,
    stream: null, engine: null, engineReady: false, elapsed: 0, lastTick: 0, target: 0, userScroll: false, recorder: null, chunks: [], recStart: 0, hudTimer: 0 };
  const scroller = $('scroller'), content = $('content'), prompter = $('prompter'), hud = $('hud');

  function setStatus(text, cls) { const s = $('pStatus'); s.textContent = text; s.className = 'pill' + (cls ? ' ' + cls : ''); }

  function renderScript() {
    P.parsed = parseScript(current.text);
    content.innerHTML = ''; P.els = [];
    let para = -1, p = null;
    P.parsed.tokens.forEach((t) => {
      while (para < t.para) { para++; p = document.createElement('p'); if (para < t.para) p.className = 'gap'; content.appendChild(p); }
      const sp = document.createElement('span');
      sp.className = t.cue ? 'w cue' : 'w'; sp.textContent = t.text;
      p.appendChild(sp); p.appendChild(document.createTextNode(' '));
      P.els.push(sp);
    });
    const end = document.createElement('p'); end.className = 'end'; end.textContent = '— end —'; content.appendChild(end);
    P.tracker = new Tracker(P.parsed.words.map((w) => w.n));
    P.shownTok = 0;
  }

  function layout() {
    const h = scroller.clientHeight, y = Math.round(h * settings.read / 100);
    content.style.fontSize = settings.font + 'px';
    content.style.lineHeight = settings.line;
    content.style.textAlign = settings.align;
    content.style.padding = y + 'px ' + settings.margin + '% ' + h + 'px';
    const rl = $('readline'); rl.style.top = y + 'px'; rl.classList.toggle('off', !settings.showLine);
    P.readY = y;
  }
  function applyPrompterSettings(key) {
    prompter.className = (P.camera ? 'camera ' : '') + 'theme-' + settings.theme + (settings.mirror !== 'none' ? ' mirror-' + settings.mirror : '');
    prompter.style.setProperty('--area', settings.area + '%');
    prompter.style.setProperty('--shade', settings.shade / 100);
    content.classList.toggle('dim', settings.dim && P.mode === 'voice');
    $('pWpm').textContent = settings.wpm;
    layout();
    if (P.mode === 'voice') { P.target = targetFor(P.tracker.pos); scroller.scrollTop = P.target; }
    if (key === 'engine' || key === 'lang') { stopEngine(); if (P.mode === 'voice') prepareEngine(); }
    if (['facing', 'quality', 'audioOnly'].includes(key) && P.camera && !P.recorder) { releaseStream(); getStream().catch(streamError); }
  }

  function tokIndexForPos(pos) { const w = P.parsed.words; return pos >= w.length ? P.els.length : w[pos].t; }
  function targetFor(pos) {
    const ti = tokIndexForPos(pos);
    const el = P.els[Math.min(ti, P.els.length - 1)];
    if (!el) return 0;
    const base = ti >= P.els.length ? el.offsetTop + el.offsetHeight : el.offsetTop;
    return Math.max(0, base - P.readY);
  }
  function paint() {
    const ti = tokIndexForPos(P.tracker.pos);
    const from = Math.min(ti, P.shownTok), to = Math.max(ti, P.shownTok);
    for (let i = Math.max(0, from - 1); i <= Math.min(to, P.els.length - 1); i++) {
      P.els[i].classList.toggle('done', i < ti);
      P.els[i].classList.toggle('cur', i === ti && P.mode === 'voice');
    }
    P.shownTok = ti;
  }
  function clearPaint() { P.els.forEach((e) => e.classList.remove('done', 'cur')); P.shownTok = 0; }
  function setPos(pos) { P.tracker.reset(pos); paint(); P.target = targetFor(P.tracker.pos); }
  function posAtReadLine() {
    const y = scroller.scrollTop + P.readY - 2;
    let lo = 0, hi = P.els.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (P.els[m].offsetTop + P.els[m].offsetHeight < y) lo = m + 1; else hi = m; }
    for (let i = lo; i < P.parsed.tokens.length; i++) if (P.parsed.tokens[i].first >= 0) return P.parsed.tokens[i].first;
    return P.parsed.words.length;
  }

  async function openPrompter(camera) {
    if (!current || !current.text.trim()) { toast('Add some text to the script first'); return; }
    P.open = true; P.camera = camera; P.playing = false; P.elapsed = 0; P.userScroll = false;
    prompter.hidden = false;
    $('pRec').hidden = !camera; $('cam').hidden = true;
    renderScript();
    P.mode = 'manual'; P.frac = 0;
    applyPrompterSettings();
    scroller.scrollTop = 0; P.target = 0;
    setMode(settings.mode, true); paint();
    $('pTimer').textContent = '0:00'; updatePlayBtn(); showHud(true);
    if (settings.full && prompter.requestFullscreen) prompter.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    wake(true);
    P.lastTick = performance.now(); requestAnimationFrame(tick);
    if (camera) { try { await getStream(); } catch (e) { streamError(e); } }
    if (P.mode === 'voice') prepareEngine();
  }
  async function closePrompter() {
    if (P.recorder) {
      const i = await ask('Stop recording?', 'The recording will be finished so you can save it.', [{ label: 'Stop and save', cls: 'primary' }, { label: 'Keep recording' }]);
      if (i !== 0) return;
      await stopRecording();
    }
    pause(); stopEngine(); releaseStream(); wake(false);
    P.open = false; prompter.hidden = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  $('pClose').onclick = closePrompter;

  function setMode(mode, quiet) {
    if (mode === 'voice' && !window.CueSpeech.pick(settings.engine)) { if (!quiet) toast('Voice tracking is not available in this browser'); mode = 'auto'; }
    const was = P.mode; P.mode = mode;
    document.querySelectorAll('#pMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $('pSpeed').style.visibility = mode === 'auto' ? 'visible' : 'hidden';
    content.classList.toggle('dim', settings.dim && mode === 'voice');
    if (mode === 'voice') { if (P.parsed) { setPos(posAtReadLine()); } if (!quiet) prepareEngine(); }
    else { if (was === 'voice') { pauseEngineOnly(); clearPaint(); } }
    if (!P.playing) setStatus(mode === 'voice' ? 'Voice: ready' : mode === 'auto' ? 'Auto scroll' : 'Manual scroll');
    else if (mode !== 'voice') setStatus(mode === 'auto' ? 'Auto scroll' : 'Manual scroll', 'live');
    else startVoice().then(() => setStatus('Listening', 'live')).catch((e) => { setStatus((e && e.message) || 'Voice tracking failed', 'err'); pause(); });
  }
  document.querySelectorAll('#pMode button').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });

  /* ----- media stream ----- */
  async function getStream() {
    const wantVideo = P.camera && !settings.audioOnly;
    if (P.stream && (P.stream.getVideoTracks().length > 0) === wantVideo) return P.stream;
    releaseStream();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot use the microphone here (needs HTTPS)');
    const h = +settings.quality;
    const constraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: wantVideo ? { facingMode: settings.facing, width: { ideal: Math.round(h * 16 / 9) }, height: { ideal: h }, frameRate: { ideal: 30 } } : false };
    P.stream = await navigator.mediaDevices.getUserMedia(constraints);
    const cam = $('cam');
    if (wantVideo) { cam.srcObject = P.stream; cam.hidden = false; cam.classList.toggle('selfie', settings.facing === 'user'); }
    else { cam.srcObject = null; cam.hidden = true; }
    return P.stream;
  }
  function releaseStream() {
    if (P.stream) P.stream.getTracks().forEach((t) => t.stop());
    P.stream = null; $('cam').srcObject = null;
  }
  function streamError(e) {
    const m = e && e.name === 'NotAllowedError' ? 'Permission denied. Allow microphone' + (P.camera ? ' and camera' : '') + ' for this site in Chrome settings.'
      : e && e.name === 'NotFoundError' ? 'No microphone or camera found.' : (e && e.message) || 'Could not start microphone or camera';
    setStatus(m, 'err'); toast(m, 6000);
  }

  /* ----- voice engine ----- */
  let enginePromise = null;
  function prepareEngine() {
    const eng = window.CueSpeech.pick(settings.engine);
    if (!eng || eng.id !== 'device' || eng.model) return;
    if (!P.playing) setStatus('Loading voice model…');
    eng.load().then(() => { if (P.open && P.mode === 'voice' && !P.playing) setStatus('Voice: ready'); })
      .catch(() => { if (P.open && P.mode === 'voice') setStatus('Voice model failed to load', 'err'); });
  }
  function onWords(words) {
    if (!P.playing || P.mode !== 'voice' || P.userScroll) return;
    const moved = P.tracker.update(words);
    if (moved) {
      paint(); P.target = targetFor(P.tracker.pos); P.lastHeard = performance.now();
      setStatus('Following', 'live');
      if (P.tracker.done) pause();
    } else if (performance.now() - (P.lastHeard || 0) > 2500) setStatus('Holding your place', 'hold');
  }
  async function startVoice() {
    if (P.engine) return true;
    if (enginePromise) return enginePromise;
    enginePromise = (async () => {
      const eng = window.CueSpeech.pick(settings.engine);
      if (!eng) throw new Error('Voice tracking is not available in this browser');
      const stream = await getStream();
      if (eng.id === 'device' && !eng.model) setStatus('Loading voice model…');
      await eng.start({ stream, lang: settings.lang, vocab: vocab(P.parsed.words), onWords, onFinal: () => P.tracker && P.tracker.endUtterance(),
        onError: (m) => { setStatus(m, 'err'); } });
      P.engine = eng;
      return true;
    })();
    try { return await enginePromise; } finally { enginePromise = null; }
  }
  function stopEngine() { if (P.engine) { try { P.engine.stop(); } catch (e) {} P.engine = null; } }
  function pauseEngineOnly() { stopEngine(); if (!P.camera) releaseStream(); }

  /* ----- transport ----- */
  function updatePlayBtn() { $('pPlay').innerHTML = P.playing ? '&#10074;&#10074;' : '&#9654;'; }
  function countdown(n) {
    return new Promise((resolve) => {
      if (!n) return resolve(true);
      const el = $('countdown'); el.hidden = false; P.counting = true;
      const step = () => {
        if (!P.counting) { el.hidden = true; return resolve(false); }
        if (n <= 0) { el.hidden = true; P.counting = false; return resolve(true); }
        el.textContent = n--; setTimeout(step, 1000);
      };
      step();
    });
  }
  let starting = false;
  async function play() {
    if (P.playing || starting || !P.open) return;
    starting = true;
    try {
      if (P.mode === 'voice') {
        if (P.tracker.done) setPos(0);
        try { await startVoice(); }
        catch (e) { if (e && e.name) streamError(e); else { setStatus((e && e.message) || 'Voice tracking failed', 'err'); toast((e && e.message) || 'Voice tracking failed'); } return; }
      }
      if (!P.open) return;
      setStatus('Get ready');
      const ok = await countdown(settings.count);
      if (!ok || !P.open) return;
      if (P.tracker) P.tracker.endUtterance();
      P.playing = true; P.lastHeard = performance.now(); P.lastTick = performance.now();
      setStatus(P.mode === 'voice' ? 'Listening' : P.mode === 'auto' ? 'Auto scroll' : 'Manual scroll', 'live');
      updatePlayBtn(); showHud(false);
    } finally { starting = false; }
  }
  function pause() {
    P.counting = false;
    if (!P.playing) return;
    P.playing = false; updatePlayBtn(); setStatus(P.mode === 'voice' && P.tracker && P.tracker.done ? 'End of script' : 'Paused'); showHud(true);
  }
  $('pPlay').onclick = () => (P.playing || P.counting ? pause() : play());
  $('pRestart').onclick = () => { pause(); scroller.scrollTop = 0; P.elapsed = 0; $('pTimer').textContent = '0:00'; if (P.mode === 'voice') setPos(0); P.target = 0; };
  $('pFontUp').onclick = () => bump('font', 4, 20, 160);
  $('pFontDown').onclick = () => bump('font', -4, 20, 160);
  $('pFaster').onclick = () => bump('wpm', 5, 60, 260);
  $('pSlower').onclick = () => bump('wpm', -5, 60, 260);
  function bump(key, d, lo, hi) {
    const anchor = P.mode === 'voice' ? null : posAtReadLine();
    settings[key] = Math.max(lo, Math.min(hi, settings[key] + d)); saveSettings(); applyPrompterSettings(key);
    if (anchor !== null && key === 'font') scroller.scrollTop = targetFor(anchor);
    showHud(true);
  }

  /* ----- animation loop ----- */
  function tick(now) {
    if (!P.open) return;
    const dt = Math.min(0.1, (now - P.lastTick) / 1000); P.lastTick = now;
    if (P.playing) {
      P.elapsed += dt; $('pTimer').textContent = fmtTime(P.elapsed);
      if (!P.userScroll) {
        if (P.mode === 'voice') {
          const diff = P.target - scroller.scrollTop;
          if (Math.abs(diff) > 0.5) scroller.scrollTop += diff * Math.min(1, dt * 5);
        } else if (P.mode === 'auto') {
          const n = Math.max(1, P.parsed.words.length);
          const textH = content.scrollHeight - P.readY - scroller.clientHeight;
          P.frac = (P.frac || 0) + (textH / n) * (settings.wpm / 60) * dt;
          const whole = Math.floor(P.frac);
          if (whole >= 1) { scroller.scrollTop += whole; P.frac -= whole; }
          if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1) { pause(); setStatus('End of script'); }
        }
      }
    }
    if (P.recorder) $('pRecTimer').textContent = 'REC ' + fmtTime((now - P.recStart) / 1000);
    requestAnimationFrame(tick);
  }

  /* ----- touch: manual scroll re-anchors voice tracking; tap toggles controls; double tap sets position ----- */
  let touchEndTimer, lastTap = 0, moved = false;
  scroller.addEventListener('touchstart', () => { P.userScroll = true; moved = false; clearTimeout(touchEndTimer); }, { passive: true });
  scroller.addEventListener('touchmove', () => { moved = true; }, { passive: true });
  scroller.addEventListener('touchend', () => {
    clearTimeout(touchEndTimer);
    touchEndTimer = setTimeout(() => {
      if (moved && P.mode === 'voice') setPos(posAtReadLine());
      P.userScroll = false;
    }, moved ? 700 : 0);
  }, { passive: true });
  scroller.addEventListener('wheel', () => {
    P.userScroll = true; clearTimeout(touchEndTimer);
    touchEndTimer = setTimeout(() => { if (P.mode === 'voice') setPos(posAtReadLine()); P.userScroll = false; }, 500);
  }, { passive: true });
  scroller.addEventListener('click', (ev) => {
    const now = Date.now();
    const el = ev.target.closest ? ev.target.closest('.w') : null;
    if (now - lastTap < 350 && el) {
      const ti = P.els.indexOf(el);
      for (let i = ti; i < P.parsed.tokens.length; i++) {
        if (P.parsed.tokens[i].first >= 0) {
          if (P.mode === 'voice') setPos(P.parsed.tokens[i].first); else scroller.scrollTop = targetFor(P.parsed.tokens[i].first);
          break;
        }
      }
      lastTap = 0; return;
    }
    lastTap = now;
    showHud(hud.classList.contains('hide'));
  });
  function showHud(on) {
    clearTimeout(P.hudTimer);
    hud.classList.toggle('hide', !on);
    if (on && P.playing) P.hudTimer = setTimeout(() => hud.classList.add('hide'), 4000);
  }
  hud.addEventListener('click', () => { if (P.playing) showHud(true); });

  /* ----- keyboard and Bluetooth remotes ----- */
  document.addEventListener('keydown', (ev) => {
    if (!P.open || !$('settings').hidden || !$('dialog').hidden) return;
    const k = ev.key;
    if (k === ' ' || k === 'Enter' || k === 'PageDown' || k === 'ArrowRight' || k === 'MediaPlayPause') { ev.preventDefault(); P.playing || P.counting ? pause() : play(); }
    else if (k === 'PageUp' || k === 'ArrowLeft') { ev.preventDefault(); backParagraph(); }
    else if (k === 'ArrowUp') { ev.preventDefault(); P.mode === 'auto' ? bump('wpm', 5, 60, 260) : nudge(-1); }
    else if (k === 'ArrowDown') { ev.preventDefault(); P.mode === 'auto' ? bump('wpm', -5, 60, 260) : nudge(1); }
    else if (k === 'Escape') { closePrompter(); }
  });
  function nudge(dir) {
    scroller.scrollTop += dir * settings.font * settings.line * 2;
    if (P.mode === 'voice') setPos(posAtReadLine());
  }
  function backParagraph() {
    const pos = posAtReadLine(), toks = P.parsed.tokens, words = P.parsed.words;
    if (!words.length) return;
    const curTok = words[Math.min(pos, words.length - 1)].t;
    let para = toks[curTok].para;
    const firstOfPara = (pp) => { for (let i = 0; i < toks.length; i++) if (toks[i].para === pp && toks[i].first >= 0) return toks[i].first; return -1; };
    let start = firstOfPara(para);
    if (start >= pos - 2) { do { para--; start = firstOfPara(para); } while (para >= 0 && start < 0); }
    start = Math.max(0, start);
    if (P.mode === 'voice') setPos(start); else scroller.scrollTop = targetFor(start);
  }

  /* ----- recording ----- */
  function pickMime(video) {
    const list = video ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  }
  async function startRecording() {
    if (!window.MediaRecorder) { toast('This browser cannot record'); return; }
    let stream;
    try { stream = await getStream(); } catch (e) { streamError(e); return; }
    const hasVideo = stream.getVideoTracks().length > 0;
    const mime = pickMime(hasVideo);
    const h = +settings.quality;
    const opts = mime ? { mimeType: mime } : {};
    if (hasVideo) opts.videoBitsPerSecond = h >= 2160 ? 30e6 : h >= 1080 ? 10e6 : 5e6;
    opts.audioBitsPerSecond = 160000;
    let rec;
    try { rec = new MediaRecorder(stream, opts); } catch (e) { rec = new MediaRecorder(stream); }
    P.chunks = []; P.recMime = rec.mimeType || mime || (hasVideo ? 'video/webm' : 'audio/webm');
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) P.chunks.push(ev.data); };
    rec.onerror = () => toast('Recording error');
    rec.start(1000);
    P.recorder = rec; P.recStart = performance.now();
    $('pRec').classList.add('on'); $('pRecTimer').hidden = false;
    if (!P.playing) play();
  }
  function stopRecording() {
    return new Promise((resolve) => {
      const rec = P.recorder;
      if (!rec) return resolve();
      rec.onstop = async () => {
        P.recorder = null; $('pRec').classList.remove('on'); $('pRecTimer').hidden = true;
        pause();
        const blob = new Blob(P.chunks, { type: P.recMime.split(';')[0] }); P.chunks = [];
        const ext = /mp4/.test(P.recMime) ? (/^audio/.test(P.recMime) ? 'm4a' : 'mp4') : 'webm';
        const d = new Date(), pad = (n) => String(n).padStart(2, '0');
        const name = window.CueFiles.safeName(current.title || 'recording') + ' ' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.' + ext;
        await saveRecording(blob, name);
        resolve();
      };
      try { rec.stop(); } catch (e) { P.recorder = null; resolve(); }
    });
  }
  async function saveRecording(blob, name) {
    const mb = (blob.size / 1048576).toFixed(1);
    for (;;) {
      const i = await ask('Recording finished', name + '\n' + mb + ' MB', [{ label: 'Save to this device', cls: 'primary' }, { label: 'Share or send to cloud' }, { label: 'Discard', cls: 'danger' }]);
      if (i === 0) { window.CueFiles.download(blob, name); toast('Saved to Downloads'); return; }
      if (i === 1) {
        const r = await window.CueFiles.share(blob, name, name);
        if (r === 'shared') return;
        if (r === 'unsupported') toast('Sharing this file is not supported here. Save it to the device instead.', 5000);
        continue;
      }
      const sure = await ask('Discard this recording?', 'It cannot be recovered.', [{ label: 'Discard', cls: 'danger' }, { label: 'Go back' }]);
      if (sure === 0) return;
    }
  }
  $('pRec').onclick = () => (P.recorder ? stopRecording() : startRecording());

  /* ----- wake lock, resize, lifecycle ----- */
  let wakeLock = null;
  async function wake(on) {
    try {
      if (on && settings.awake && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { if (P.open) wake(true); }
    else { commitEdit(); if (P.open && !P.recorder) pause(); }
  });
  window.addEventListener('pagehide', commitEdit);
  let resizeTimer;
  window.addEventListener('resize', () => {
    if (!P.open) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const anchor = P.mode === 'voice' ? P.tracker.pos : posAtReadLine();
      layout(); P.target = targetFor(anchor); scroller.scrollTop = P.target;
    }, 150);
  });

  /* ---------- start ---------- */
  renderLibrary();
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || local)) {
    navigator.serviceWorker.register('sw.js').then(() => { $('offlineState').textContent = 'Works offline'; }).catch(() => {});
  }
  window.CueApp = { P, settings, get scripts() { return scripts; }, play, pause, setMode, onWords, openEditor, openPrompter };
})();
