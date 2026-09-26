/* =====================================================================
   VIRTUAL ANGKLUNG — app.js
   Web Audio API, dua mode permainan, kontrol touch/mouse/keyboard/shake.
   ===================================================================== */

(() => {
  'use strict';

  /* =====================================================================
     0. KONFIGURASI (mudah diubah)
     ===================================================================== */

  // Sampel fisik yang benar-benar ada di folder soundbank/ (1 oktaf: C4–C5).
  const BASE_NOTES = ['c4', 'd4', 'e4', 'f4', 'g4', 'a4', 'b4', 'c5'];

  // Mode Solo tetap memakai 1 oktaf dasar sesuai sampel asli.
  const SOLO_NOTES = [
    { id: 'c4', label: 'C4' }, { id: 'd4', label: 'D4' },
    { id: 'e4', label: 'E4' }, { id: 'f4', label: 'F4' },
    { id: 'g4', label: 'G4' }, { id: 'a4', label: 'A4' },
    { id: 'b4', label: 'B4' }, { id: 'c5', label: 'C5' },
  ];

  // Mode Piano/Ensemble: diperluas jadi 2 oktaf penuh (C4–C6).
  // Oktaf ke-2 (D5–C6) BELUM punya file fisik di soundbank, jadi memakai
  // "pitch shift" bawaan Web Audio API (AudioBufferSourceNode.playbackRate)
  // dari sampel oktaf pertama: playbackRate = 2.0 menaikkan nada tepat 1 oktaf.
  // Contoh: D5 = sampel d4.wav diputar dengan playbackRate 2.0.
  const PIANO_NOTES = [
    { id: 'c4', label: 'C4', file: 'c4', rate: 1 },
    { id: 'd4', label: 'D4', file: 'd4', rate: 1 },
    { id: 'e4', label: 'E4', file: 'e4', rate: 1 },
    { id: 'f4', label: 'F4', file: 'f4', rate: 1 },
    { id: 'g4', label: 'G4', file: 'g4', rate: 1 },
    { id: 'a4', label: 'A4', file: 'a4', rate: 1 },
    { id: 'b4', label: 'B4', file: 'b4', rate: 1 },
    { id: 'c5', label: 'C5', file: 'c5', rate: 1 },
    { id: 'd5', label: 'D5', file: 'd4', rate: 2 }, // pitch-shift 1 oktaf
    { id: 'e5', label: 'E5', file: 'e4', rate: 2 },
    { id: 'f5', label: 'F5', file: 'f4', rate: 2 },
    { id: 'g5', label: 'G5', file: 'g4', rate: 2 },
    { id: 'a5', label: 'A5', file: 'a4', rate: 2 },
    { id: 'b5', label: 'B5', file: 'b4', rate: 2 },
    { id: 'c6', label: 'C6', file: 'c5', rate: 2 },
  ];

  // Lookup gabungan dipakai oleh audio engine: noteId -> { file, rate }.
  const NOTE_AUDIO_MAP = {};
  SOLO_NOTES.forEach((n) => { NOTE_AUDIO_MAP[n.id] = { file: n.id, rate: 1 }; });
  PIANO_NOTES.forEach((n) => { NOTE_AUDIO_MAP[n.id] = { file: n.file, rate: n.rate }; });

  // Jendela tampilan "Octave Shift" di Mode Piano: menunjuk ke index awal
  // tabung yang di-scroll ke posisi paling kiri saat tombol ditekan.
  const OCTAVE_VIEWS = [
    { label: 'C4 – C5', startIndex: 0 },
    { label: 'C5 – C6', startIndex: 7 },
  ];

  // Pemetaan tombol keyboard PC -> nada dasar (urutan A S D F G H J K).
  const KEY_MAP = {
    a: 'c4', s: 'd4', d: 'e4', f: 'f4',
    g: 'g4', h: 'a4', j: 'b4', k: 'c5',
  };

  // Lokasi file suara (hanya 8 file fisik yang benar-benar di-fetch).
  const SOUND_PATH = (fileId) => `soundbank/${fileId}.wav`;

  // ---- KONFIGURASI AUDIO (silakan ubah sesuai kebutuhan) ----
  const AUDIO_CONFIG = {
    loopStart: 0.8,     // detik: titik mulai loop (sesuai permintaan spek)
    loopEnd: 2.5,       // detik: titik akhir loop (sesuai permintaan spek)
    releaseTime: 0.3,   // detik: durasi fade-out saat nada dilepas
    attackTime: 0.005,  // detik: fade-in super singkat agar tidak "klik"
    masterVolume: 0.9,
  };
  // CATATAN: sampel asli (freesound.org, ~0.7–1.3 detik) lebih pendek dari
  // loopEnd default (2.5s). loopStart/loopEnd DALAM SATUAN WAKTU BUFFER ASLI
  // (tidak terpengaruh playbackRate/pitch-shift), dan di-clamp aman lewat
  // getSafeLoopPoints() supaya tetap kompatibel dengan sampel custom yg lebih panjang.
  function getSafeLoopPoints(buffer) {
    const duration = buffer.duration;
    let start = Math.min(AUDIO_CONFIG.loopStart, duration * 0.35);
    let end = Math.min(AUDIO_CONFIG.loopEnd, duration - 0.02);
    if (end <= start) { start = 0; end = duration; } // fallback: loop seluruh buffer
    return { start, end };
  }

  // ---- KONFIGURASI SHAKE (goyang HP) ----
  const SHAKE_THRESHOLD = 15;      // sensitivitas deteksi goyang (m/s^2 gabungan delta)
  const SHAKE_STOP_DELAY_MS = 350; // baru stop setelah TIDAK ada gerakan selama ini

  // ---- KONFIGURASI UKURAN TABUNG ENSEMBLE (responsif, dihitung di JS) ----
  const TUBE_SIZE = {
    mobile:  { minWidth: 46, maxWidth: 62, minHeight: 92,  maxHeight: 205 },
    desktop: { minWidth: 54, maxWidth: 78, minHeight: 112, maxHeight: 248 },
  };
  const MOBILE_BREAKPOINT = '(max-width: 640px)';

  /* =====================================================================
     1. STATE & ELEMEN DOM
     ===================================================================== */

  const state = {
    audioCtx: null,
    buffers: {},           // { fileId: AudioBuffer } — hanya 8 buffer fisik
    voices: {},            // { noteId: { source, gainNode } } — suara yang sedang berbunyi
    currentNote: 'c4',     // nada aktif di Mode Solo
    mode: 'solo',
    shakeEnabled: false,
    shakeIsPlaying: false, // true selagi loop shake sedang berbunyi (hold state)
    shakeStopTimer: null,  // timer debounce untuk stop otomatis setelah diam
    lastMotion: null,
    audioReady: false,
    octaveViewIndex: 0,    // index ke OCTAVE_VIEWS, dipakai tombol Octave Shift
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
    octaveDownBtn: document.getElementById('octaveDown'),
    octaveUpBtn: document.getElementById('octaveUp'),
    octaveRangeLabel: document.getElementById('octaveRangeLabel'),
  };

  /* =====================================================================
     2. AUDIO ENGINE (Web Audio API)
     ===================================================================== */

  function initAudioContext() {
    if (state.audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new Ctx();
  }

  // Preload seluruh sampel fisik -> decode ke AudioBuffer agar bebas latency.
  // Catatan: hanya 8 file (BASE_NOTES) yang benar-benar di-fetch; nada oktaf
  // ke-2 di Mode Piano memakai buffer yang sama dengan playbackRate berbeda.
  async function loadAllBuffers(onProgress) {
    let loaded = 0;
    const total = BASE_NOTES.length;
    await Promise.all(BASE_NOTES.map(async (fileId) => {
      const res = await fetch(SOUND_PATH(fileId));
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await state.audioCtx.decodeAudioData(arrayBuffer);
      state.buffers[fileId] = audioBuffer;
      loaded += 1;
      if (onProgress) onProgress(loaded, total);
    }));
  }

  // Mulai bunyi sebuah nada (dipanggil saat touchstart/mousedown/keydown/shake).
  function triggerNote(noteId) {
    const audioCfg = NOTE_AUDIO_MAP[noteId];
    if (!state.audioReady || !audioCfg || !state.buffers[audioCfg.file]) return;

    // Jika nada yang sama masih berbunyi (retrigger cepat), hentikan dulu tanpa klik.
    stopVoice(noteId, 0.03);

    const ctx = state.audioCtx;
    const buffer = state.buffers[audioCfg.file];
    const { start, end } = getSafeLoopPoints(buffer);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = start;
    source.loopEnd = end;
    // Pitch-shift: 1.0 = nada asli, 2.0 = naik 1 oktaf (dipakai nada D5–C6).
    source.playbackRate.value = audioCfg.rate;

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
    // Mode Ensemble: tandai tabung yang sesuai (jika sedang tampil di rak).
    const ensembleTube = el.ensembleRack.querySelector(`[data-note="${noteId}"]`);
    if (ensembleTube) ensembleTube.classList.toggle('playing', isPlaying);
  }

  /* =====================================================================
     4. BANGUN UI: PILL NADA (MODE SOLO)
     ===================================================================== */

  function buildNoteSelector() {
    el.noteSelector.innerHTML = '';
    SOLO_NOTES.forEach((note) => {
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
    const prevNote = state.currentNote;
    state.currentNote = noteId;
    el.soloNoteLabel.textContent = SOLO_NOTES.find((n) => n.id === noteId).label;
    el.noteSelector.querySelectorAll('.note-pill').forEach((p) => {
      p.classList.toggle('selected', p.dataset.note === noteId);
    });
    // Jika sedang berbunyi lewat mode shake dan nada diganti, pindahkan bunyinya
    // ke nada baru secara mulus alih-alih membiarkan nada lama terus berbunyi.
    if (state.shakeIsPlaying && prevNote !== noteId) {
      releaseNote(prevNote);
      triggerNote(noteId);
    }
  }

  /* =====================================================================
     5. BANGUN UI: RAK TABUNG (MODE ENSEMBLE, 2 OKTAF)
     ===================================================================== */

  function buildEnsembleRack() {
    el.ensembleRack.innerHTML = '';
    PIANO_NOTES.forEach((note, index) => {
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
      label.innerHTML = `${note.label}${keyChar ? `<span class="key-hint">${keyChar.toUpperCase()}</span>` : ''}`;

      wrap.appendChild(tubeInner);
      wrap.appendChild(label);
      el.ensembleRack.appendChild(wrap);

      bindEnsembleTubeEvents(wrap, note.id);
    });
    applyAllTubeSizes();
  }

  // Menghitung & menerapkan ukuran tabung secara proporsional (tabung nada
  // rendah = lebih besar), dengan lebar minimum yang aman untuk touch target
  // di layar HP supaya risiko salah tekan nada berkurang.
  function applyAllTubeSizes() {
    const isMobile = window.matchMedia(MOBILE_BREAKPOINT).matches;
    const sizes = isMobile ? TUBE_SIZE.mobile : TUBE_SIZE.desktop;
    const total = PIANO_NOTES.length;

    el.ensembleRack.querySelectorAll('.ensemble-tube').forEach((wrap) => {
      const index = Number(wrap.dataset.index);
      const t = total > 1 ? index / (total - 1) : 0;
      const width = sizes.maxWidth - t * (sizes.maxWidth - sizes.minWidth);
      const height = sizes.maxHeight - t * (sizes.maxHeight - sizes.minHeight);
      const tubeInner = wrap.querySelector('.tube-inner');
      tubeInner.style.width = `${width}px`;
      tubeInner.style.height = `${height}px`;
    });
  }

  // Sesuaikan ulang ukuran saat viewport berpindah antara mobile <-> desktop
  // (mis. rotasi layar), dengan debounce ringan agar tidak dipanggil berlebihan.
  let resizeTimer = null;
  function bindResizeHandler() {
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyAllTubeSizes, 150);
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
     ---------------------------------------------------------------------
     PERBAIKAN BUG "suara patah-patah": sebelumnya setiap frame gerakan yang
     melewati threshold langsung memicu trigger+auto-release baru, sehingga
     tumpang-tindih dan terdengar staccato. Sekarang memakai logika
     hold+debounce:
       1. Saat gerakan pertama melewati threshold -> mulai loop audio (jika
          belum berbunyi).
       2. Setiap kali gerakan terdeteksi lagi selagi masih di atas threshold,
          RESET timer penghenti (bukan memicu ulang audio).
       3. Audio baru benar-benar di-fade-out & dihentikan setelah tidak ada
          gerakan signifikan selama SHAKE_STOP_DELAY_MS (~350ms).
     ===================================================================== */

  function stopAngklungFromShake() {
    if (!state.shakeIsPlaying) return;
    releaseNote(state.currentNote);
    state.shakeIsPlaying = false;
    state.shakeStopTimer = null;
  }

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

    if (delta > SHAKE_THRESHOLD) {
      // 1) Nyalakan loop audio kalau belum berbunyi (bukan memicu ulang tiap frame).
      if (!state.shakeIsPlaying) {
        triggerNote(state.currentNote);
        state.shakeIsPlaying = true;
      }
      // 2) Reset timer penghenti setiap kali ada gerakan baru terdeteksi.
      if (state.shakeStopTimer) clearTimeout(state.shakeStopTimer);
      state.shakeStopTimer = setTimeout(stopAngklungFromShake, SHAKE_STOP_DELAY_MS);
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
    if (state.shakeStopTimer) {
      clearTimeout(state.shakeStopTimer);
      state.shakeStopTimer = null;
    }
    if (state.shakeIsPlaying) {
      releaseNote(state.currentNote);
      state.shakeIsPlaying = false;
    }
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
     9. OCTAVE SHIFT (MODE PIANO) — menggeser tampilan rak ke oktaf lain
     ===================================================================== */

  function scrollToOctaveView(viewIndex) {
    const view = OCTAVE_VIEWS[viewIndex];
    if (!view) return;
    const targetTube = el.ensembleRack.querySelector(`[data-index="${view.startIndex}"]`);
    if (targetTube) {
      targetTube.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    }
    el.octaveRangeLabel.textContent = view.label;
    el.octaveDownBtn.disabled = viewIndex <= 0;
    el.octaveUpBtn.disabled = viewIndex >= OCTAVE_VIEWS.length - 1;
  }

  function bindOctaveShiftButtons() {
    el.octaveDownBtn.addEventListener('click', () => {
      state.octaveViewIndex = Math.max(0, state.octaveViewIndex - 1);
      scrollToOctaveView(state.octaveViewIndex);
    });
    el.octaveUpBtn.addEventListener('click', () => {
      state.octaveViewIndex = Math.min(OCTAVE_VIEWS.length - 1, state.octaveViewIndex + 1);
      scrollToOctaveView(state.octaveViewIndex);
    });
    scrollToOctaveView(state.octaveViewIndex); // set label & disabled state awal
  }

  /* =====================================================================
     10. NAVIGASI MODE (SOLO <-> ENSEMBLE)
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

        // Pastikan ukuran tabung sudah benar saat panel ensemble baru ditampilkan
        // (elemen tersembunyi bisa punya ukuran terhitung 0 sebelum ditampilkan).
        if (mode === 'ensemble') applyAllTubeSizes();
      });
    });
  }

  /* =====================================================================
     11. OVERLAY START / UNLOCK AUDIO
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
     12. INISIALISASI
     ===================================================================== */

  function init() {
    buildNoteSelector();
    buildEnsembleRack();
    bindSoloInstrumentEvents();
    bindKeyboardEvents();
    bindShakeToggle();
    bindOctaveShiftButtons();
    bindModeSwitch();
    bindStartOverlay();
    bindResizeHandler();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
