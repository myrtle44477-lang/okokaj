GG-KEP1 — Voratoon Netlify build

Isi:
- index.html
- netlify/functions/voratoon.js

Cara deploy:
1. Ekstrak ZIP ini.
2. Upload isi folder gg-kep1-voratoon ke project/site Netlify (index.html harus berada di root publish directory).
3. Pastikan Netlify memakai Node.js 18 atau lebih baru.
4. Deploy ulang, lalu buka domain Netlify.

Endpoint:
- /.netlify/functions/voratoon?action=home
- /.netlify/functions/voratoon?action=search&q=solo
- /.netlify/functions/voratoon?action=detail&slug=slug-komik
- /.netlify/functions/voratoon?action=chapter&slug=slug-komik&chapter=1
- /.netlify/functions/voratoon?action=ranking&period=Daily
- /.netlify/functions/voratoon?action=genres

Catatan:
Scraper mengambil HTML dari 13.voratoon.com melalui Netlify Function. Jika Voratoon mengubah struktur Next.js,
memblokir IP/server Netlify, atau host gambar menolak hotlink, data/gambar bisa gagal dimuat.
UI akan menampilkan pesan dan tombol Coba Lagi; ini tidak bisa menjamin sumber pihak ketiga selalu tersedia.
