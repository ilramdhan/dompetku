/** Privacy policy and terms content. Strings are Indonesian DICT keys (English in i18n.tsx). */
/** Last content change of the privacy policy and terms (ISO date, rendered per language). */
export const LEGAL_UPDATED = "2026-10-31";

export type LegalSection = {
  id: string;
  title: string;
  /** Paragraphs (Indonesian DICT keys). */
  body?: string[];
  /** Bullet list items (Indonesian DICT keys). */
  items?: string[];
};

export function formatLegalDate(iso: string, lang: "id" | "en"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export const PRIVACY_INTRO =
  'Dompetku adalah aplikasi open source yang di-host sendiri. Kebijakan ini menjelaskan data apa yang disimpan instance ini, di mana disimpan, dan siapa yang bisa mengaksesnya. "Pemilik instance" adalah orang yang memasang dan menjalankan salinan aplikasi ini.';

export const PRIVACY: LegalSection[] = [
  {
    id: "data-disimpan",
    title: "Data yang disimpan",
    body: [
      "Data keuangan yang Anda masukkan — akun, transaksi, budget, hutang, piutang, emas, target, foto struk, dan pengaturan — disimpan di proyek Supabase (PostgreSQL dan Storage) milik pemilik instance.",
      "Database hanya diakses oleh server aplikasi ini; browser tidak pernah terhubung langsung ke database. Pembuat Dompetku tidak memiliki akses ke instance ini.",
      "Bila fitur invoice dipakai, data pelanggan yang diisi pemilik instance (nama, email, telepon) dan bukti transfer yang diunggah pelanggan juga disimpan di sana. Untuk membatasi penyalahgunaan unggahan, alamat IP pengunggah hanya disimpan dalam bentuk hash.",
    ],
  },
  {
    id: "tidak-dijual",
    title: "Tidak dijual, tidak dibagikan",
    body: [
      "Pemilik instance tidak menjual, menyewakan, atau membagikan data Anda untuk iklan. Data hanya dikirim ke layanan pihak ketiga yang diaktifkan pemilik instance, sebatas yang dibutuhkan fitur tersebut (lihat di bawah).",
    ],
  },
  {
    id: "cookie",
    title: "Cookie & penyimpanan browser",
    items: [
      "Satu cookie sesi httpOnly yang ditandatangani, hanya untuk menjaga Anda tetap masuk.",
      "localStorage untuk preferensi tema, bahasa, dan mode privasi.",
      "Tidak ada analitik, piksel pelacak, atau cookie pihak ketiga.",
    ],
  },
  {
    id: "pihak-ketiga",
    title: "Layanan pihak ketiga (bila dikonfigurasi)",
    body: ["Bergantung pada konfigurasi pemilik instance, layanan berikut dapat menerima data:"],
    items: [
      "Supabase — menyimpan database dan foto struk.",
      "Vercel atau penyedia hosting lain — menjalankan server dan menerima permintaan HTTP beserta log standar.",
      "Penyedia AI (API yang kompatibel dengan OpenAI) — menerima foto struk atau teks transaksi untuk dibaca, beserta daftar nama kategori.",
      "Telegram dan n8n — meneruskan pesan bot, ringkasan, dan pengingat antara Anda dan aplikasi.",
      "Resend — mengirim email pengingat ke alamat yang diatur pemilik instance, serta email invoice, konfirmasi pembayaran, dan pengingat jatuh tempo ke email pelanggan invoice.",
      "Midtrans (payment gateway) — bila pembayaran online diaktifkan, menerima nomor invoice, jumlah tagihan, serta nama, email, dan telepon pelanggan untuk memproses pembayaran. Data kartu atau e-wallet diisi langsung di halaman Midtrans dan tidak pernah melewati aplikasi ini.",
      "Sentry — menerima laporan error teknis (pesan error dan konteks permintaan), bukan isi data keuangan Anda.",
      "Google Drive — menyimpan file backup bila backup terjadwal diaktifkan.",
    ],
  },
  {
    id: "hapus-backup",
    title: "Backup & penghapusan data",
    body: [
      "Anda dapat mengekspor seluruh data sebagai backup JSON dan memulihkannya kapan saja dari Pengaturan. Data yang dihapus di aplikasi dihapus dari database; untuk menghapus semuanya, pemilik instance dapat menghapus proyek Supabase dan deployment-nya.",
    ],
  },
  {
    id: "kontak",
    title: "Kontak",
    body: [
      "Pertanyaan tentang data di instance ini ditujukan kepada pemilik instance yang mengoperasikannya. Masalah pada kode sumber dapat dilaporkan di repositori GitHub proyek.",
    ],
  },
];

export const TERMS_INTRO =
  "Dengan memakai instance Dompetku ini, Anda menyetujui ketentuan singkat berikut. Ketentuan ini melengkapi, bukan menggantikan, lisensi MIT dari kode sumbernya.";

export const TERMS: LegalSection[] = [
  {
    id: "lisensi",
    title: "Lisensi",
    body: [
      "Kode sumber Dompetku dirilis di bawah Lisensi MIT. Anda bebas memakai, menyalin, mengubah, dan mendistribusikannya selama pemberitahuan hak cipta dan lisensi tetap disertakan.",
    ],
  },
  {
    id: "tanpa-jaminan",
    title: "Tanpa jaminan",
    body: [
      'Perangkat lunak ini disediakan "apa adanya", tanpa jaminan apa pun, tersurat maupun tersirat. Pembuat dan kontributor tidak bertanggung jawab atas kehilangan data, kerugian, atau kerusakan yang timbul dari penggunaannya.',
    ],
  },
  {
    id: "bukan-nasihat",
    title: "Bukan nasihat keuangan",
    body: [
      "Dompetku adalah alat pencatatan. Angka, proyeksi, harga emas, dan hasil pembacaan AI bisa keliru dan bukan nasihat keuangan, investasi, atau pajak. Selalu periksa ulang sebelum mengambil keputusan.",
    ],
  },
  {
    id: "tanggung-jawab",
    title: "Tanggung jawab Anda",
    items: [
      "Pemilik instance bertanggung jawab atas deployment, keamanan server, kunci API, kata sandi, dan backup-nya sendiri.",
      "Pemilik instance wajib mematuhi ketentuan layanan pihak ketiga yang dipakai (Supabase, Vercel, penyedia AI, Telegram, Midtrans, dan lainnya).",
    ],
  },
  {
    id: "penggunaan",
    title: "Penggunaan yang wajar",
    body: [
      "Jangan memakai aplikasi ini untuk aktivitas yang melanggar hukum, untuk mengakses data orang lain tanpa izin, atau untuk mengganggu layanan pihak ketiga yang terhubung.",
    ],
  },
  {
    id: "perubahan",
    title: "Perubahan",
    body: [
      'Ketentuan dan kebijakan ini dapat diperbarui seiring perkembangan proyek. Tanggal "terakhir diperbarui" di atas menunjukkan versi terbaru; terus memakai aplikasi berarti menerima versi tersebut.',
    ],
  },
];
