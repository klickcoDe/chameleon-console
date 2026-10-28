/* ============================================================
   Konfigurasi runtime UI Chameleon Console.

   apiBase kosong = UI memanggil API di origin yang sama (mode lokal/Docker
   dan saat UI + API disajikan oleh server.js yang sama).

   Isi bila UI dihosting terpisah dari backend, misalnya:
     - UI  : https://chameleon.vercel.app
     - API : https://api.contoh.com
   Maka apiBase = "https://api.contoh.com" (tanpa garis miring di akhir).

   Di Vercel, berkas ini ditulis otomatis saat build dari env
   CHAMELEON_API_URL — lihat scripts/vercel-config.mjs dan docs/vercel.md.
   ============================================================ */
window.CHAMELEON_CONFIG = {
  apiBase: '',
};
