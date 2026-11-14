/* Speech engines. Both call onWords(words[]) with the utterance so far and onFinal() when an utterance ends. */
(function () {
  'use strict';
  const MODEL_URL = 'voice-model.tar.gz';
  const MODEL_PARTS = ['voice-model.part00', 'voice-model.part01'];

  /* The service worker joins the model parts, so wait until it controls this page. */
  async function swControl() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 4000))]);
      if (!reg || navigator.serviceWorker.controller) return;
      await new Promise((r) => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 3000); });
    } catch (e) {}
  }


  /* On-device recognition (Vosk, WebAssembly). Works offline, no beeps, shares the mic with the recorder. */
  const VoskEngine = {
    id: 'device',
    model: null,
    loading: null,
    available() { return typeof Vosk !== 'undefined' && typeof WebAssembly !== 'undefined'; },
    load() {
      if (this.model) return Promise.resolve(this.model);
      if (!this.loading) {
        this.loading = (async () => {
          await swControl();
          const url = new URL(MODEL_URL, location.href).href;
          try { this.model = await Vosk.createModel(url); }
          catch (e) {
            // No service worker to join the parts: join them here instead.
            const parts = await Promise.all(MODEL_PARTS.map((p) => fetch(p).then((r) => { if (!r.ok) throw new Error('Voice model files are missing'); return r.arrayBuffer(); })));
            this.model = await Vosk.createModel(URL.createObjectURL(new Blob(parts, { type: 'application/gzip' })));
          }
          return this.model;
        })().catch((e) => { this.loading = null; throw e; });
      }
      return this.loading;
    },
    async start({ stream, vocab, onWords, onFinal, onError }) {
      const model = await this.load();
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      const grammar = vocab && vocab.length ? JSON.stringify(vocab.concat(['[unk]'])) : undefined;
      const rec = new model.KaldiRecognizer(this.ctx.sampleRate, grammar);
      this.rec = rec;
      rec.on('partialresult', (m) => { const t = m.result && m.result.partial; if (t) onWords(t.split(' ')); });
      rec.on('result', (m) => { const t = m.result && m.result.text; if (t) onWords(t.split(' ')); onFinal(); });
      rec.on('error', (m) => onError && onError(m.error || 'recognizer error'));
      this.src = this.ctx.createMediaStreamSource(stream);
      this.node = this.ctx.createScriptProcessor(2048, 1, 1);
      this.node.onaudioprocess = (e) => { try { rec.acceptWaveform(e.inputBuffer); } catch (err) { /* recognizer gone */ } };
      this.src.connect(this.node);
      this.node.connect(this.ctx.destination); // output stays silent; needed for the node to run
    },
    stop() {
      try { this.node && (this.node.onaudioprocess = null, this.node.disconnect()); } catch (e) {}
      try { this.src && this.src.disconnect(); } catch (e) {}
      try { this.rec && this.rec.remove(); } catch (e) {}
      try { this.ctx && this.ctx.close(); } catch (e) {}
      this.node = this.src = this.rec = this.ctx = null;
    },
  };

  /* Chrome's built-in recognition. Needs internet. On Android it restarts often and can chime. */
  const WebSpeechEngine = {
    id: 'browser',
    available() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
    load() { return Promise.resolve(); },
    async start({ stream, lang, onWords, onFinal, onError }) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const android = /Android/i.test(navigator.userAgent);
      this.active = true;
      const begin = () => {
        if (!this.active) return;
        const r = new SR();
        this.r = r;
        r.lang = lang || 'en-US';
        r.continuous = true;
        r.interimResults = true;
        r.onresult = (ev) => {
          let text = '';
          if (android) text = ev.results[ev.results.length - 1][0].transcript; // Android repeats the running text
          else for (let i = 0; i < ev.results.length; i++) text += ' ' + ev.results[i][0].transcript;
          onWords(text.trim().split(/\s+/));
          if (android && ev.results[ev.results.length - 1].isFinal) onFinal();
        };
        r.onerror = (ev) => {
          if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { this.active = false; onError && onError('Microphone or speech service blocked'); }
          else if (ev.error === 'network') onError && onError('Chrome speech needs internet');
        };
        r.onend = () => { onFinal(); if (this.active) setTimeout(begin, 150); };
        const track = stream && stream.getAudioTracks()[0];
        try { track ? r.start(track) : r.start(); } catch (e) { try { r.start(); } catch (e2) {} }
      };
      begin();
    },
    stop() {
      this.active = false;
      try { this.r && this.r.abort(); } catch (e) {}
      this.r = null;
    },
  };

  window.CueSpeech = {
    VoskEngine, WebSpeechEngine,
    pick(pref) {
      if (pref === 'browser' && WebSpeechEngine.available()) return WebSpeechEngine;
      if (VoskEngine.available()) return VoskEngine;
      if (WebSpeechEngine.available()) return WebSpeechEngine;
      return null;
    },
  };
})();
