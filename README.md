# Temp Mail — Cloudflare Workers

Email sementara dengan desain responsif, mode terang/gelap otomatis, salin kode OTP, dan tombol buka tautan dari email. Backend dan konfigurasi domain asli tetap dipertahankan.

## Menjalankan / deploy

Dari folder `tempmail-cf` (gunakan Node.js yang didukung Wrangler):

```sh
npm install
npm run dev
```

Untuk memperbarui Worker di akun Cloudflare Anda:

```sh
npx wrangler login
npm run deploy
```

Domain diatur melalui `vars.MAIL_DOMAIN` di `wrangler.jsonc` (saat ini `wanzabigail.my.id`). TTL diatur melalui `TTL_MINUTES`. Untuk menerima email, domain harus dikonfigurasi pada Cloudflare Email Routing dan aturan catch-all diarahkan ke Worker `tempmail`. Setelah deploy, kirim email percobaan untuk memeriksa koneksi Email Routing.

Jangan membuka `index.html` langsung sebagai file: frontend membutuhkan endpoint `/api/config` dan `/api/inbox/*` dari Worker.

## Fitur

- Alamat acak baru, nama alamat pilihan, salin alamat, dan alamat tersimpan di browser.
- Kotak masuk diperiksa setiap 5 detik saat tab aktif; tersedia tombol segarkan manual.
- Klik email untuk melihat panel tindakan cepat. Panel OTP/tautan hanya muncul jika ditemukan.
- **Salin OTP:** mendeteksi angka 4–8 digit, format `123 456` / `123-456`, dan kode alfanumerik huruf besar yang mengandung angka di dekat kata OTP/kode/verifikasi/code/PIN. Nol di depan tetap dipertahankan. Angka pada URL tidak dibaca sebagai kode. Deteksi bersifat heuristik, bukan jaminan untuk semua format; cocokkan dengan isi email. Kode berupa gambar tidak dideteksi.
- **Buka tautan:** mengambil URL dari teks email dan atribut `href` email HTML, menghilangkan duplikat, serta membuka HTTP/HTTPS di tab baru dengan `noopener noreferrer`. Tautan relatif, mailto, URL berkredensial, javascript, data, dan file tidak ditampilkan sebagai tombol. Tautan tidak dibuka otomatis.
- Pesan HTML ditampilkan dalam iframe sandbox tanpa izin script. Konten aktif dan atribut event dihapus; gambar eksternal tidak dimuat untuk mengurangi tracking. HTML email tetap berlatar putih agar format asli terbaca pada mode gelap.
- Konfirmasi sebelum menghapus semua email atau beralih dari kotak masuk yang berisi pesan.
- Clipboard menggunakan API browser pada HTTPS, dengan fallback dan pesan kesalahan jika penyalinan diblokir.

## Struktur

- `public/index.html`: struktur antarmuka.
- `public/styles.css`: gaya responsif dan mode gelap.
- `public/app.js`: kotak masuk, deteksi OTP/tautan, dan pengamanan tampilan email.
- `src/worker.js`: backend asli Cloudflare Workers + Durable Objects.
- `tests/ui.cjs`: uji UI dengan API tiruan (tidak mengirim email sungguhan).

## Pengujian lokal UI (opsional)

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/ui.cjs
```

Jika menggunakan Chromium sistem, atur `CHROMIUM_PATH` ke lokasi executable-nya. Tes mencakup 9 kasus deteksi OTP/tautan, clipboard, sanitasi HTML, validasi nama, hapus email, dan overflow halaman pada lebar 390px/1280px. Tampilan desktop, ponsel, kotak masuk kosong, dan mode gelap telah diperiksa dengan email contoh. Integrasi Cloudflare dan email sungguhan tetap perlu diperiksa setelah deploy.

## Catatan keamanan

Kotak masuk ini **tidak dilindungi kata sandi**: siapa pun yang mengetahui nama alamat dapat mengakses atau menghapus pesannya. Jangan gunakan untuk akun penting, OTP perbankan, data pribadi, atau pemulihan akun. Selalu periksa domain tujuan tautan; tombol buka tautan bukan pemeriksaan anti-phishing.

Email tersimpan paling banyak 50 pesan per kotak masuk dan dihapus otomatis setelah TTL tanpa aktivitas. Tab yang aktif terus melakukan polling sehingga memperpanjang aktivitas kotak masuk.
