# Procurement AI Analyst — Setup

3 file utama:
- `admin.html` — buat KAMU aja, upload & kelola source data. Jangan share ke client.
- `chat.html` — buat CLIENT/tim, cuma chat, ga bisa lihat/upload data mentah.
- `shared.js` — mesin di baliknya (koneksi Firebase + rumus forecast/MOI/breakdown/OOS), dipakai kedua halaman.
- `firebase-config.js` — kunci koneksi ke project Firebase kamu.
- `ai-config.js` — URL backend narasi AI (opsional, isi setelah langkah 4).
- `functions/` — backend kecil (Cloud Function) yang manggil Anthropic API dengan aman.

## 1. Buat project Firebase (gratis)
1. Buka https://console.firebase.google.com → **Add project** → kasih nama bebas.
2. Di sidebar kiri, klik **Build → Firestore Database → Create database** → pilih mode **Production**, lokasi terserah (pilih yang paling dekat, mis. `asia-southeast2` Jakarta).
3. Di sidebar kiri, klik **Build → Authentication → Get started** → tab **Sign-in method** → aktifkan **Anonymous**.
4. Klik ikon gear ⚙️ (Project settings) → scroll ke bawah **Your apps** → klik ikon web `</>` → daftarkan app (nama bebas) → nanti muncul object `firebaseConfig`.
5. Copy isinya ke file `firebase-config.js`, ganti semua `GANTI_...`.

## 2. Set aturan keamanan Firestore
Di Firebase Console → Firestore Database → tab **Rules**, ganti isinya jadi:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Ini artinya: hanya browser yang sudah "masuk" lewat app ini (otomatis, anonim) yang bisa baca/tulis data. Ini proteksi dasar — kalau mau lebih ketat (misal cuma email tertentu yang boleh upload lewat `admin.html`), bilang aja nanti aku bantu upgrade ke Google Sign-In + whitelist email.

## 4. (Opsional tapi kamu mau ini) Aktifkan narasi AI
Ini butuh **Firebase plan "Blaze"** (pay-as-you-go) — bukan berarti otomatis kena biaya, tier gratisnya tetap ada, cuma Google mewajibkan plan ini kalau Cloud Function mau manggil API di luar Google (kayak api.anthropic.com). Upgrade di Console → klik nama project → **Upgrade** (kanan bawah).

1. Siapkan API key Anthropic kamu (dari https://console.anthropic.com → API Keys).
2. Install tool Firebase (sekali aja): `npm install -g firebase-tools`
3. Login: `firebase login`
4. Di folder project ini (sejajar sama folder `functions/`), jalankan: `firebase init functions` → pilih project Firebase kamu → pilih JavaScript → **jangan** timpa file yang sudah ada.
5. Simpan API key dengan aman (bukan ditulis di kode): `firebase functions:secrets:set ANTHROPIC_API_KEY` → paste key kamu.
6. Deploy: `firebase deploy --only functions`
7. Setelah selesai, terminal kasih URL semacam `https://askai-xxxxxxxxxx-uc.a.run.app` — copy itu ke `ai-config.js` (ganti `AI_ENDPOINT`).
8. Push ulang ke GitHub. Sekarang tiap jawaban forecast/MOI di `chat.html` bakal ada tambahan insight 💡 dari AI — tapi AI-nya cuma boleh komentar dari angka yang sudah dihitung rumus, bukan bikin angka baru.

Kalau langkah ini dilewati / `ai-config.js` dibiarkan default, chat tetap jalan normal pakai rumus saja (tanpa insight 💡).

## 5. Deploy ke GitHub Pages
1. Push folder ini (`admin.html`, `chat.html`, `shared.js`, `firebase-config.js`) ke satu repo GitHub.
2. Repo → **Settings → Pages** → Source: pilih branch `main` folder `/ (root)` → Save.
3. Tunggu ~1 menit, link jadi `https://namakamu.github.io/namarepo/`.
4. Kasih ke tim: `.../chat.html`. Buat kamu sendiri: `.../admin.html`.
5. (Opsional) Mau custom domain sendiri (misal `analyst.perusahaanku.com`) tinggal set di Settings → Pages → Custom domain, ikuti instruksi DNS dari GitHub.

## Cara pakai
1. Buka `admin.html`, upload Master List, Pareto, Store List, Sales, Stock, dst.
2. Tim buka `chat.html`, tanya bebas: "hitungkan forecast bulan depan dan MOI nya", "breakdown kategori Pareto A", "SKU mana yang berisiko OOS?".
3. Kalau data yang dibutuhkan belum diupload, bot jawab "Data tidak ditemukan" dan sebutkan data apa yang kurang.

## Catatan
- Angka (forecast, MOI, breakdown, OOS) selalu dari rumus, bukan dari AI — jadi konsisten & bisa dipertanggungjawabkan.
- Insight 💡 di bawah angka (opsional, kalau kamu setup langkah 4) ditulis AI tapi dikunci hanya boleh komentar dari angka yang sudah dihitung — AI dilarang menambah angka baru lewat prompt di `shared.js`.
- Kalau nanti mau ketat lagi (misal AI harus lebih hati-hati, atau ganti model), tinggal edit prompt di fungsi `askAIInsight` (`shared.js`) atau di `functions/index.js`.
