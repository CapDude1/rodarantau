# Roda Rantau

Board game online orisinal untuk 2–4 pemain. Pemain menjelajahi kota, membeli dan meningkatkan tempat usaha, membayar atau menerima sewa, mengambil kartu kejadian, dan mengelola kas. Permainan berakhir setelah 12 putaran; kekayaan bersih tertinggi menang.

## Menjalankan server

Pasang Node.js 18 atau lebih baru, lalu dari folder proyek jalankan:

```powershell
npm install
npm start
```

Buka `http://localhost:3000`. Untuk bermain dari perangkat lain di jaringan yang sama, buka alamat IP komputer yang menjalankan server, misalnya `http://192.168.1.10:3000`. Agar dapat diakses melalui internet, deploy server ke host publik dan gunakan HTTPS/WSS melalui reverse proxy.

Buat room dan bagikan kode lima karakter kepada pemain lain. Server menyinkronkan giliran dan aksi. Room dan progres tersimpan di memori server, jadi akan hilang ketika server dimulai ulang. Pemain yang terputus dapat bergabung kembali dari sesi browser yang sama; saat gilirannya tiba, pemain lain dapat melanjutkan giliran pemain offline.

7j8lFokoshDy9P