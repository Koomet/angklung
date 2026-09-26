# Virtual Angklung 🎋

Aplikasi web interaktif Virtual Angklung — Vanilla JavaScript murni (HTML, CSS, JS), tanpa framework eksternal, siap deploy ke GitHub Pages.

## Struktur folder

```
virtual-angklung/
├── index.html
├── style.css
├── app.js
├── README.md
└── soundbank/
    ├── c4.wav
    ├── d4.wav
    ├── e4.wav
    ├── f4.wav
    ├── g4.wav
    ├── a4.wav
    ├── b4.wav
    └── c5.wav
```

## Cara deploy ke GitHub Pages

1. Buat repository baru di GitHub, lalu push seluruh isi folder ini ke branch `main`.
2. Buka **Settings → Pages** pada repository.
3. Pilih source: `Deploy from a branch`, branch `main`, folder `/ (root)`.
4. Tunggu beberapa menit, situs akan tersedia di `https://<username>.github.io/<nama-repo>/`.

Tidak perlu proses build apa pun — semua file sudah statis dan langsung jalan di browser.

## Catatan teknis penting

- **Titik loop audio**: sampel suara asli (rekaman angklung Bandung, lihat kredit di bawah) berdurasi sekitar 0.7–1.3 detik. Nilai `loopStart`/`loopEnd` di `app.js` (bagian `AUDIO_CONFIG`) diset sesuai permintaan awal (0.8s / 2.5s) sebagai *nilai target* yang mudah diubah, tetapi fungsi `getSafeLoopPoints()` otomatis meng-clamp nilai tersebut ke durasi asli tiap buffer, supaya tetap aman baik dipakai dengan sample bawaan maupun sample custom yang lebih panjang.
- **Goyang HP (shake-to-play)**: di iOS 13+, izin sensor gerak (`DeviceMotionEvent.requestPermission`) hanya bisa diminta lewat interaksi user langsung (klik toggle) — sudah ditangani di `app.js`.
- Ganti file di `soundbank/` dengan sampel angklungmu sendiri jika perlu — cukup pastikan nama file tetap `c4.wav` s.d. `c5.wav`.

## Kredit sampel suara

Sampel suara angklung ("Bandung angklung vib") oleh **Parking Sun**, diunduh dari [Freesound.org](https://freesound.org/people/Parking%20Sun/packs/4799/), dilisensikan di bawah [Creative Commons Attribution 3.0](http://creativecommons.org/licenses/by/3.0/). Wajib mencantumkan atribusi ini jika aplikasi dipublikasikan (sudah disertakan di footer `index.html`).
