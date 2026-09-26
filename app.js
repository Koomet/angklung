/* =====================================================================
   VIRTUAL ANGKLUNG — app.js
   Web Audio API, dua mode permainan, kontrol touch/mouse/keyboard/shake.
   ===================================================================== */

(() => {
  'use strict';

  /* =====================================================================
     0. KONFIGURASI (mudah diubah)
     ===================================================================== */

  // Daftar nada, urut dari rendah ke tinggi. Sesuai daftar soundbank di spek.
  const NOTES = [
    { id: 'c4', label: 'C4' },
    { id: 'd4', label: 'D4' },
    { id: 'e4', label: 'E4' },
    { id: 'f4', label: 'F4' },
    { id: 'g4', label: 'G4' },
    { id: 'a4', label: 'A4' },
    { id: 'b4', label: 'B4' },
    { id: 'c5', label: 'C5' },
  ];

  // Pemetaan tombol keyboard PC -> nada (urutan A S D F G H J K).
  const KEY_MAP = {
    a: 'c4', s: 'd4', d: 'e4', f: 'f4',
    g: 'g4', h: 'a4', j: 'b4', k: 'c5',
  };

  // Lokasi file suara.
  const SOUND_PATH = (noteId) => `soundbank/${noteId}.wav`;

  // ---- KONFIGURASI AUDIO (silakan ubah sesuai kebutuhan) ----
  const AUDIO_CONFIG = {
    loopStart: 0.8,     // detik: titik mulai loop (sesuai permintaan spek)
    loopEnd: 2.5,       // detik: titik akhir loop (sesuai permintaan spek)
    releaseTime: 0.3,   // detik: durasi fade-out saat nada dilepas
    attackTime: 0.005,  // detik: fade-in super singkat agar tidak "klik"
    masterVolume: 0.9,
  };
  // CATATAN PENTING:
  // Sampel audio asli (rekaman angklung Bandung dari freesound.org, ~0.7–1.3 detik)
  // lebih pendek dari loopEnd default (2.5s) di atas. Agar aplikasi tetap aman
  // dipakai baik dengan sampel bawaan ini MAUPUN sampel custom yang lebih
  // panjang, titik loop dihitung ulang secara aman per-buffer lewat
  // getSafeLoopPoints() di bawah — nilai AUDIO_CONFIG di atas tetap jadi
  // "target" ideal, otomatis di-clamp ke durasi buffer yang sebenarnya.
  function getSafeLoopPoints(buffer) {
    const duration = buffer.duration;
    let start = Math.min(AUDIO_CONFIG.loopStart, duration * 0.35);
    let end = Math.min(AUDIO_CONFIG.loopEnd, duration - 0.02);
    if (end <= start) { start = 0; end = duration; } // fallback: loop seluruh buffer
    return { start, end };
  }

  const SHAKE_THRESHOLD = 16;   // sensitivitas deteksi goyang (m/s^2 gabungan delta)
  const SHAKE_COOLDOWN_MS = 380; // jeda minimum antar-trigger shake
  const SHAKE_SOUND_HOLD_MS = 260; // berapa lama nada "ditahan" saat dipicu shake

  /* =====================================================================
     1. STATE & ELEMEN DOM
     ===================================================================== */

  const state = {
    audioCtx: null,
    buffers: {},          // { noteId: AudioBuffer }
    voices: {},           // { noteId: { source, gainNode } } — suara yang sedang berbunyi
    currentNote: 'c4',    // nada aktif di Mode Solo
    mode: 'solo',
    shakeEnabled: false,
    lastMotion: null,
    lastShakeAt: 0,
    audioReady: false,
  };

  const el = {
    startOverlay: document.getElementById('startOverlay'),
    startBtn: document.getElementById('startBtn'),
    startStatus: document.getElementById('startStatus'),
    tabSolo: document.getElementById('tabSolo'),
    tabEnsemble: document.getElementById('tabEnsemble'),
    soloMode: document.getElementById('soloMode'),
    ensembleMode: document.getElementById('ensembleMode'),
    noteSelector: document.getElementById('noteSelector'),
    angklungSolo: document.getElementById('angklungSolo'),
    soloNoteLabel: document.getElementById('soloNoteLabel'),
    ensembleRack: document.getElementById('ensembleRack'),
    shakeToggle: document.getElementById('shakeToggle'),
    shakeStatus: document.getElementById('shakeStatus'),
  };

  /* =====================================================================
     2. AUDIO ENGINE (Web Audio API)
     ===================================================================== */

  function initAudioContext() {
    if (state.audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new Ctx();
  }

  // Preload seluruh sampel -> decode ke AudioBuffer agar bebas latency saat main.
  async function loadAllBuffers(onProgress) {
    let loaded = 0;
    const total = NOTES.length;
    await Promise.all(NOTES.map(async (note) => {
      const res = await fetch(SOUND_PATH(note.id));
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await state.audioCtx.decodeAudioData(arrayBuffer);
      state.buffers[note.id] = audioBuffer;
      loaded += 1;
      if (onProgress) onProgress(loaded, total);
    }));
  }

  // Mulai bunyi sebuah nada (dipanggil saat touchstart/mousedown/keydown/shake).
  function triggerNote(noteId) {
    if (!state.audioReady || !state.buffers[noteId]) return;

    // Jika nada yang sama masih berbunyi (retrigger cepat), hentikan dulu tanpa klik.
    stopVoice(noteId, 0.03);

    const ctx = state.audioCtx;
    const buffer = state.buffers[noteId];
    const { start, end } = getSafeLoopPoints(buffer);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = start;
    source.loopEnd = end;

    const gainNode = ctx.createGain();
    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(AUDIO_CONFIG.masterVolume, now + AUDIO_CONFIG.attackTime);

    source.connect(gainNode).connect(ctx.destination);
    source.start(0);

    state.voices[noteId] = { source, gainNode };
    setTubeVisualPlaying(noteId, true);
  }

  // Lepas nada dengan fade-out eksponensial (release) supaya halus, tidak "klik".
  function releaseNote(noteId) {
    stopVoice(noteId, AUDIO_CONFIG.releaseTime);
    setTubeVisualPlaying(noteId, false);
  }

  function stopVoice(noteId, fadeSeconds) {
    const voice = state.voices[noteId];
    if (!voice) return;
    const ctx = state.audioCtx;
    const { source, gainNode } = voice;
    const now = ctx.currentTime;
    try {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(Math.max(gainNode.gain.value, 0.0001), now);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);
      source.stop(now + fadeSeconds + 0.02);
    } catch (err) {
      /* voice mungkin sudah berhenti, aman diabaikan */
    }
    delete state.voices[noteId];
  }

  /* =====================================================================
     3. TAMPILAN VISUAL (getar tabung saat berbunyi)
     ===================================================================== */

  function setTubeVisualPlaying(noteId, isPlaying) {
    // Mode Solo: hanya tampilkan getar jika nada yang dimainkan == nada aktif.
    if (noteId === state.currentNote) {
      el.angklungSolo.classList.toggle('playing', isPlaying);
    }
    // Mode Ensemble: tandai tabung yang sesuai.
    const ensembleTube = el.ensembleRack.querySelector(`[data-note="${noteId}"]`);
    if (ensembleTube) ensembleTube.classList.toggle('playing', isPlaying);
  }

  /* =====================================================================
     4. BANGUN UI: PILL NADA (MODE SOLO)
     ===================================================================== */

  function buildNoteSelector() {
    el.noteSelector.innerHTML = '';
    NOTES.forEach((note) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'note-pill' + (note.id === state.currentNote ? ' selected' : '');
      pill.textContent = note.label;
      pill.dataset.note = note.id;
      pill.setAttribute('role', 'option');
      pill.addEventListener('click', () => selectSoloNote(note.id));
      el.noteSelector.appendChild(pill);
    });
  }

  function selectSoloNote(noteId) {
    state.currentNote = noteId;
    el.soloNoteLabel.textContent = NOTES.find(n => n.id === noteId).label;
    el.noteSelector.querySelectorAll('.note-pill').forEach((p) => {
      p.classList.toggle('selected', p.dataset.note === noteId);
    });
  }

  /* =====================================================================
     5. BANGUN UI: RAK TABUNG (MODE ENSEMBLE)
     ===================================================================== */

  function buildEnsembleRack() {
    el.ensembleRack.innerHTML = '';
    NOTES.forEach((note, index) => {
      const wrap = document.createElement('div');
      wrap.className = 'ensemble-tube';
      wrap.dataset.note = note.id;
      wrap.dataset.index = index;

      const tubeInner = document.createElement('div');
      tubeInner.className = 'tube tube-inner';
      const shine = document.createElement('span');
      shine.className = 'tube-shine';
      tubeInner.appendChild(shine);

      const label = document.createElement('div');
      label.className = 'ensemble-label';
      const keyChar = Object.keys(KEY_MAP).find((k) => KEY_MAP[k] === note.id) || '';
      label.innerHTML = `${note.label}<span class="key-hint">${keyChar.toUpperCase()}</span>`;

      wrap.appendChild(tubeInner);
      wrap.appendChild(label);
      el.ensembleRack.appendChild(wrap);

      bindEnsembleTubeEvents(wrap, note.id);
    });
  }

  /* =====================================================================
     6. INPUT: TOUCH / MOUSE (mendukung multi-touch untuk akor)
     ===================================================================== */

  // Melacak jari mana (touch identifier) sedang memainkan nada apa,
  // supaya multi-touch chord di Mode Ensemble bekerja dengan benar.
  const activeTouchNotes = new Map(); // touchId -> noteId

  function bindEnsembleTubeEvents(wrapEl, noteId) {
    // --- Sentuhan (mobile) ---
    wrapEl.addEventListener('touchstart', (e) => {
      e.preventDefault(); // cegah double-tap zoom & delay 300ms di browser mobile
      for (const touch of e.changedTouches) {
        activeTouchNotes.set(touch.identifier, noteId);
      }
      triggerNote(noteId);
    }, { passive: false });

    wrapEl.addEventListener('touchend', (e) => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        if (activeTouchNotes.get(touch.identifier) === noteId) {
          activeTouchNotes.delete(touch.identifier);
        }
      }
      releaseNote(noteId);
    }, { passive: false });

    wrapEl.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      for (const touch of e.changedTouches) activeTouchNotes.delete(touch.identifier);
      releaseNote(noteId);
    }, { passive: false });

    // --- Mouse (desktop) ---
    wrapEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      wrapEl.dataset.mousePressed = '1';
      triggerNote(noteId);
    });
    wrapEl.addEventListener('mouseup', () => {
      if (wrapEl.dataset.mousePressed === '1') {
        wrapEl.dataset.mousePressed = '';
        releaseNote(noteId);
      }
    });
    wrapEl.addEventListener('mouseleave', () => {
      if (wrapEl.dataset.mousePressed === '1') {
        wrapEl.dataset.mousePressed = '';
        releaseNote(noteId);
      }
    });
  }

  function bindSoloInstrumentEvents() {
    const target = el.angklungSolo;

    target.addEventListener('touchstart', (e) => {
      e.preventDefault();
      triggerNote(state.currentNote);
    }, { passive: false });

    target.addEventListener('touchend', (e) => {
      e.preventDefault();
      releaseNote(state.currentNote);
    }, { passive: false });

    target.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      releaseNote(state.currentNote);
    }, { passive: false });

    target.addEventListener('mousedown', (e) => {
      e.preventDefault();
      target.dataset.mousePressed = '1';
      triggerNote(state.currentNote);
    });
    target.addEventListener('mouseup', () => {
      if (target.dataset.mousePressed === '1') {
        target.dataset.mousePressed = '';
        releaseNote(state.currentNote);
      }
    });
    target.addEventListener('mouseleave', () => {
      if (target.dataset.mousePressed === '1') {
        target.dataset.mousePressed = '';
        releaseNote(state.currentNote);
      }
    });

    // Aksesibilitas keyboard: Enter/Spasi menekan instrumen saat fokus.
    target.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        triggerNote(state.currentNote);
      }
    });
    target.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        releaseNote(state.currentNote);
      }
    });
  }

  /* =====================================================================
     7. INPUT: KEYBOARD PC (A S D F G H J K)
     ===================================================================== */

  const pressedKeys = new Set();

  function bindKeyboardEvents() {
    document.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      const noteId = KEY_MAP[key];
      if (!noteId || pressedKeys.has(key)) return;
      pressedKeys.add(key);

      if (state.mode === 'solo') {
        // Di mode solo, tombol keyboard sekaligus memindah nada aktif lalu memainkannya.
        selectSoloNote(noteId);
      }
      triggerNote(noteId);
    });

    document.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      const noteId = KEY_MAP[key];
      if (!noteId) return;
      pressedKeys.delete(key);
      releaseNote(noteId);
    });
  }

  /* =====================================================================
     8. SENSOR GERAK (SHAKE TO PLAY) — MODE SOLO
     ===================================================================== */

  function handleDeviceMotion(e) {
    const acc = e.accelerationIncludingGravity || e.acceleration;
    if (!acc || acc.x === null) return;

    if (!state.lastMotion) {
      state.lastMotion = { x: acc.x, y: acc.y, z: acc.z };
      return;
    }

    const delta =
      Math.abs(acc.x - state.lastMotion.x) +
      Math.abs(acc.y - state.lastMotion.y) +
      Math.abs(acc.z - state.lastMotion.z);

    state.lastMotion = { x: acc.x, y: acc.y, z: acc.z };

    const now = Date.now();
    if (delta > SHAKE_THRESHOLD && now - state.lastShakeAt > SHAKE_COOLDOWN_MS) {
      state.lastShakeAt = now;
      triggerNote(state.currentNote);
      // Goyangan adalah gestur sesaat (bukan "tahan"), jadi nada dilepas otomatis.
      setTimeout(() => releaseNote(state.currentNote), SHAKE_SOUND_HOLD_MS);
    }
  }

  async function enableShake() {
    // iOS 13+ mewajibkan permintaan izin eksplisit dari user gesture.
    const DME = window.DeviceMotionEvent;
    if (DME && typeof DME.requestPermission === 'function') {
      try {
        const result = await DME.requestPermission();
        if (result !== 'granted') {
          el.shakeStatus.textContent = 'Izin sensor gerak ditolak. Aktifkan lewat pengaturan browser.';
          el.shakeToggle.checked = false;
          return;
        }
      } catch (err) {
        el.shakeStatus.textContent = 'Sensor gerak tidak tersedia di perangkat ini.';
        el.shakeToggle.checked = false;
        return;
      }
    } else if (!('DeviceMotionEvent' in window)) {
      el.shakeStatus.textContent = 'Perangkat/browser ini tidak mendukung sensor gerak.';
      el.shakeToggle.checked = false;
      return;
    }

    state.lastMotion = null;
    window.addEventListener('devicemotion', handleDeviceMotion);
    state.shakeEnabled = true;
    el.shakeStatus.textContent = 'Goyang HP aktif — coba goyangkan perangkatmu!';
  }

  function disableShake() {
    window.removeEventListener('devicemotion', handleDeviceMotion);
    state.shakeEnabled = false;
    el.shakeStatus.textContent = '';
  }

  function bindShakeToggle() {
    el.shakeToggle.addEventListener('change', () => {
      if (el.shakeToggle.checked) enableShake();
      else disableShake();
    });
  }

  /* =====================================================================
     9. NAVIGASI MODE (SOLO <-> ENSEMBLE)
     ===================================================================== */

  function bindModeSwitch() {
    const buttons = [el.tabSolo, el.tabEnsemble];
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === state.mode) return;
        state.mode = mode;

        buttons.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', String(active));
        });

        el.soloMode.classList.toggle('active', mode === 'solo');
        el.ensembleMode.classList.toggle('active', mode === 'ensemble');
      });
    });
  }

  /* =====================================================================
     10. OVERLAY START / UNLOCK AUDIO
     ===================================================================== */

  function bindStartOverlay() {
    el.startBtn.addEventListener('click', async () => {
      el.startBtn.disabled = true;
      el.startStatus.textContent = 'Menyiapkan audio…';
      try {
        initAudioContext();
        await state.audioCtx.resume(); // buka blokir autoplay browser mobile

        el.startStatus.textContent = 'Memuat sampel suara…';
        await loadAllBuffers((loaded, total) => {
          el.startStatus.textContent = `Memuat sampel suara… (${loaded}/${total})`;
        });

        state.audioReady = true;
        el.startOverlay.classList.add('hidden');
      } catch (err) {
        console.error(err);
        el.startStatus.textContent = 'Gagal memuat audio. Coba muat ulang halaman.';
        el.startBtn.disabled = false;
      }
    });
  }

  /* =====================================================================
     11. INISIALISASI
     ===================================================================== */

  function init() {
    buildNoteSelector();
    buildEnsembleRack();
    bindSoloInstrumentEvents();
    bindKeyboardEvents();
    bindShakeToggle();
    bindModeSwitch();
    bindStartOverlay();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
