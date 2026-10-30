# Payment gateway (Midtrans) — panduan / guide

Panduan ini untuk **pemilik instance** Dompetku yang ingin pelanggannya bisa membayar invoice secara
online (kartu, e-wallet, QRIS, virtual account) lewat **Midtrans Snap**. Tidak perlu bisa coding.

This guide is for **Dompetku instance owners** who want customers to pay invoices online (card,
e-wallet, QRIS, virtual account) through **Midtrans Snap**. No coding needed.

- [Bahasa Indonesia](#bahasa-indonesia)
  - [1. Untuk apa fitur ini?](#1-untuk-apa-fitur-ini)
  - [2. Prasyarat](#2-prasyarat)
  - [3. Ambil Server Key dan Client Key](#3-ambil-server-key-dan-client-key)
  - [4. Isi Pengaturan → Integrasi](#4-isi-pengaturan--integrasi)
  - [5. Atur Notification URL dan Finish URL](#5-atur-notification-url-dan-finish-url)
  - [6. Uji di sandbox](#6-uji-di-sandbox)
  - [7. Pindah ke production](#7-pindah-ke-production)
  - [8. Refund](#8-refund)
  - [9. Status dan artinya](#9-status-dan-artinya)
  - [10. Troubleshooting](#10-troubleshooting)
  - [11. Catatan keamanan](#11-catatan-keamanan)
  - [12. FAQ](#12-faq)
  - [13. Batasan](#13-batasan)
- [English](#english)
  - [1. What is it for?](#1-what-is-it-for)
  - [2. Prerequisites](#2-prerequisites)
  - [3. Get the Server Key and Client Key](#3-get-the-server-key-and-client-key)
  - [4. Fill in Settings → Integrasi](#4-fill-in-settings--integrasi)
  - [5. Set the Notification URL and Finish URL](#5-set-the-notification-url-and-finish-url)
  - [6. Test in sandbox](#6-test-in-sandbox)
  - [7. Go to production](#7-go-to-production)
  - [8. Refunds](#8-refunds)
  - [9. Statuses](#9-statuses)
  - [10. Troubleshooting](#10-troubleshooting-1)
  - [11. Security notes](#11-security-notes)
  - [12. FAQ](#12-faq-1)
  - [13. Limitations](#13-limitations)

Di seluruh panduan, ganti `dompet.example.com` dengan domain instance Anda.
Throughout this guide, replace `dompet.example.com` with your instance's domain.

---

## Bahasa Indonesia

### 1. Untuk apa fitur ini?

Tanpa gateway, pelanggan membayar invoice dengan transfer manual lalu mengunggah bukti, dan Anda
memverifikasinya (v24). Dengan Midtrans, pelanggan menekan **Bayar sekarang** di halaman invoice
publik, membayar di halaman Midtrans, dan invoice **otomatis** tercatat lunas begitu Midtrans
mengonfirmasi. Tidak ada bukti yang perlu dicek.

```
Pelanggan                Dompetku                         Midtrans
   |  buka /i/<token>       |                                  |
   |----------------------->|                                  |
   |  klik "Bayar sekarang" |  buat order (jumlah = sisa)      |
   |----------------------->|--------------------------------->|
   |      halaman Snap      |<------- token + redirect_url ----|
   |<-----------------------|                                  |
   |  bayar (QRIS/kartu/VA) ---------------------------------->|
   |                        |<-- notifikasi (webhook) ---------|
   |                        |  cek tanda tangan                |
   |                        |  cek ulang status ke API ------->|
   |                        |<-------------- status asli ------|
   |                        |  catat pembayaran (pemasukan "Invoice")
   |                        |  kirim email konfirmasi (opsional)
   |  invoice tampil Lunas  |                                  |
```

Setiap pembayaran sukses dicatat sebagai **pemasukan kategori "Invoice"** di dompet invoice,
persis seperti pembayaran manual.

### 2. Prasyarat

1. **Skema v25** sudah dijalankan: buka Supabase → SQL Editor, tempel seluruh
   `supabase/schema.sql`, lalu Run (aman diulang). v25 butuh v21, v23 dan v24.
2. **Tautan publik invoice** sudah bisa dipakai (v23), karena tombol bayar ada di halaman publik.
3. **`SESSION_SECRET`** (≥ 32 karakter) sudah diatur. Rate limit dan penyimpanan rahasia
   membutuhkannya.
4. **Akun Midtrans**. Daftar di <https://dashboard.midtrans.com>. Akun baru otomatis punya
   **sandbox** (uji coba, tanpa uang sungguhan). Production butuh verifikasi bisnis dari Midtrans.
5. Instance bisa diakses publik lewat **HTTPS** (Vercel/Lovable/Docker dengan domain). Midtrans
   tidak bisa mengirim notifikasi ke `localhost`.

> [!TIP]
> Selalu mulai dari **sandbox**. Pindah ke production hanya setelah satu pembayaran uji
> berhasil tercatat otomatis.

### 3. Ambil Server Key dan Client Key

1. Masuk ke <https://dashboard.midtrans.com>.
2. Pilih lingkungan di kiri atas: **Sandbox** (untuk uji) atau **Production**.
3. Buka **Settings → Access Keys**.
4. Salin:
   - **Server Key** (sandbox diawali `SB-Mid-server-…`). **Rahasia**, jangan dibagikan.
   - **Client Key** (sandbox diawali `SB-Mid-client-…`). Publik, dipakai di browser pelanggan.

Key sandbox dan production **berbeda**. Jangan mencampurnya.

### 4. Isi Pengaturan → Integrasi

Masuk Dompetku sebagai admin → **Pengaturan → Integrasi → Payment gateway (Midtrans)**:

| Kolom                 | Isi                                      |
| --------------------- | ---------------------------------------- |
| `MIDTRANS_SERVER_KEY` | Server Key dari langkah 3                |
| `MIDTRANS_CLIENT_KEY` | Client Key dari langkah 3                |
| `MIDTRANS_PRODUCTION` | `false` (sandbox) dulu                   |
| `MIDTRANS_ENABLED`    | `true` setelah tiga kolom di atas terisi |

Server Key disimpan terenkripsi dan tidak pernah ditampilkan lagi (hanya 4 karakter terakhir).
Perubahan berlaku dalam ±1 menit.

**Alternatif lewat env** (Vercel → Settings → Environment Variables, lalu Redeploy): isi
variabel dengan nama yang sama. Nilai di Pengaturan menang atas env. Lihat
[ENVIRONMENT.md](ENVIRONMENT.md#payment-gateway-midtrans-optional).

### 5. Atur Notification URL dan Finish URL

Di dashboard Midtrans (lingkungan yang sama dengan key Anda) → **Settings → Configuration**
(di beberapa akun: **Settings → Payment → Notification URL**):

| Kolom                        | Isi                                                       |
| ---------------------------- | --------------------------------------------------------- |
| **Payment Notification URL** | `https://dompet.example.com/api/public/payments/midtrans` |
| **Finish Redirect URL**      | `https://dompet.example.com/` (opsional, lihat catatan)   |

Klik **Update**.

- Notification URL **wajib** dan harus `https://`, port standar, tanpa login.
- Finish URL: bila `PUBLIC_SITE_URL=https://dompet.example.com` diatur, Dompetku mengirim alamat
  kembali per pembayaran (`/i/<token>?gw=1`), yang menang atas dashboard. **Tanpa
  `PUBLIC_SITE_URL`** Dompetku tidak mengirim alamat kembali (header Host tidak dipercaya) dan
  Midtrans memakai **Finish Redirect URL** dari dashboard, isi dengan domain Anda.

### 6. Uji di sandbox

1. Buat invoice, terbitkan, buat tautan publik (**Rincian → Bagikan**), lalu buka tautannya di
   jendela privat.
2. Klik **Bayar sekarang**. Halaman pembayaran Midtrans muncul.
3. Pilih misalnya **QRIS** atau **GoPay**. Gunakan **simulator sandbox** Midtrans
   (<https://simulator.sandbox.midtrans.com>) untuk "membayar" QR/VA tersebut, atau kartu uji
   sandbox dari dokumentasi Midtrans.
4. Dalam beberapa detik invoice berubah menjadi **Lunas** (atau **Dibayar sebagian**), dan di
   **Invoice → Rincian** muncul pembayaran dengan metode `Midtrans (…)` dan bagian
   **Transaksi Midtrans**.
5. Cek **Transaksi**: ada pemasukan kategori "Invoice".

Jika status tidak berubah, buka **Rincian → Transaksi Midtrans → Cek status**. Tombol ini
membaca status langsung dari Midtrans, berguna bila notifikasi terlewat.

### 7. Pindah ke production

1. Pastikan akun Midtrans production sudah aktif (disetujui Midtrans).
2. Di dashboard **Production**, salin Server Key & Client Key production (tanpa awalan `SB-`).
3. Atur Notification URL yang sama di lingkungan **Production**.
4. Di Pengaturan → Integrasi: ganti `MIDTRANS_SERVER_KEY` dan `MIDTRANS_CLIENT_KEY`, lalu ubah
   `MIDTRANS_PRODUCTION` menjadi `true`.
5. Lakukan satu pembayaran kecil sungguhan, lalu refund bila perlu.

Order sandbox lama tetap terlihat di riwayat, tetapi tidak bisa dicek ulang dengan key production.

### 8. Refund

Di **Invoice → Rincian → Transaksi Midtrans**, tombol **Refund** muncul untuk pembayaran yang
berhasil dan bisa direfund. Isi jumlah (kosong = semua sisa) dan alasan, lalu konfirmasi.

- **Bisa direfund lewat Midtrans:** kartu kredit/debit, GoPay, ShopeePay, QRIS, DANA, OVO,
  Kredivo, Akulaku. ShopeePay dan OVO **hanya refund penuh**.
- **Tidak bisa:** transfer bank / virtual account, Indomaret/Alfamart, dll. Kembalikan dana secara
  manual (mis. transfer), lalu catat sendiri.
- Hanya pembayaran berstatus **settlement** di Midtrans. Kartu yang baru `capture` (belum
  settlement, biasanya H+1) harus ditunggu.
- Batas waktu refund berbeda tiap metode (mulai 7 hari). Lihat dokumentasi Midtrans.

Yang dilakukan Dompetku saat refund:

- **Tidak menghapus apa pun.** Pembayaran asli tetap ada.
- Mencatat **pengeluaran pembalik** di kategori "Invoice" pada dompet yang sama, sehingga saldo
  dompet ikut turun.
- Mengurangi "sudah dibayar" pada invoice (juga di laporan dan halaman publik), sehingga
  statusnya kembali menjadi **Dibayar sebagian** atau **Belum dibayar**.
- **Menahan penagihan:** setelah refund, tombol **Bayar sekarang** disembunyikan dan pengingat
  jatuh tempo tidak dikirim, agar pelanggan yang baru di-refund tidak ditagih lagi. Di
  **Transaksi Midtrans** pilih:
  - **Batalkan invoice** (aksi biasa, setelah pembayaran dihapus/di-refund penuh) bila pelanggan
    tidak perlu membayar lagi; atau
  - **Tagih ulang** bila sisa tagihan memang harus dibayar lagi (tombol dan pengingat aktif lagi).
- Refund yang dibuat langsung di dashboard Midtrans juga ikut dicatat ketika notifikasi
  `refund`/`partial_refund` masuk atau saat Anda menekan **Cek status**.

### 9. Status dan artinya

| Status di Dompetku    | Status Midtrans                                 | Arti                                                             |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Menunggu pembayaran   | `pending`, `authorize`, `capture` + `challenge` | Order dibuat, pelanggan belum selesai membayar / sedang ditinjau |
| Berhasil              | `settlement`, `capture` + `accept`              | Uang diterima, pembayaran tercatat                               |
| Gagal                 | `deny`, `cancel`, `failure`                     | Ditolak atau dibatalkan, tidak ada uang                          |
| Lewat batas waktu     | `expire`                                        | Pelanggan tidak membayar sebelum batas waktu (24 jam)            |
| Dikembalikan sebagian | `partial_refund`                                | Sebagian dana dikembalikan                                       |
| Dikembalikan          | `refund`                                        | Seluruh dana dikembalikan                                        |

Notifikasi yang datang terlambat **tidak** menurunkan status: misalnya `expire` setelah
`settlement` diabaikan, sehingga pembayaran yang sudah lunas tidak pernah batal karena urutan
notifikasi.

### 10. Troubleshooting

| Gejala                                        | Penyebab & solusi                                                                                                                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tombol **Bayar sekarang** tidak muncul        | Cek: v25 sudah dijalankan; `MIDTRANS_ENABLED=true`; Server Key terisi; invoice berstatus Belum dibayar/Dibayar sebagian; sisa tagihan bilangan bulat rupiah (tanpa sen); bukan instance demo.                                          |
| Klik bayar → "Pembayaran online gagal dibuat" | Server Key salah atau tertukar sandbox/production (`SB-…` hanya untuk `MIDTRANS_PRODUCTION=false`). Lihat log server (Vercel → Logs, `gateway:create`).                                                                                |
| Webhook tidak masuk                           | Notification URL salah/belum disimpan di lingkungan yang benar; domain tidak publik; HTTPS bermasalah. Di dashboard Midtrans buka transaksi → **Notification history** untuk melihat kode respons. Sementara itu pakai **Cek status**. |
| Webhook dijawab **401**                       | Tanda tangan tidak cocok: Server Key di Dompetku berbeda dengan akun/lingkungan yang mengirim notifikasi.                                                                                                                              |
| Webhook dijawab **503**                       | Gateway nonaktif (termasuk key dan mode tidak cocok) atau v25 belum dijalankan. Midtrans akan mencoba ulang.                                                                                                                           |
| Tombol bayar hilang setelah refund            | Disengaja: invoice ditahan setelah refund. Buka **Transaksi Midtrans → Tagih ulang** atau batalkan invoice.                                                                                                                            |
| Webhook dijawab **403**                       | Instance demo (`DEMO_MODE=true`): pembayaran online selalu nonaktif.                                                                                                                                                                   |
| Status Berhasil tapi invoice tidak berubah    | Lihat pesan merah di **Transaksi Midtrans**: mis. invoice sudah lunas/dibatalkan lebih dulu atau jumlah tidak cocok. Uang tetap diterima: refund atau catat manual.                                                                    |
| Invoice tidak bisa dihapus                    | Invoice punya transaksi Midtrans yang tertunda/berhasil. Batalkan invoice saja; riwayat pembayaran tidak boleh hilang.                                                                                                                 |
| Pembayaran Midtrans tidak bisa dihapus        | Disengaja. Gunakan **Refund**.                                                                                                                                                                                                         |

### 11. Catatan keamanan

- **Server Key write-only:** disimpan terenkripsi (AES-256-GCM), tidak pernah dikirim ke browser
  atau ikut backup. Browser hanya menerima Client Key (memang publik) dan token pembayaran.
- **Notifikasi tidak dipercaya mentah-mentah:** tanda tangan SHA-512 dicek, lalu status dan
  jumlah **selalu dibaca ulang dari API Midtrans** dan jumlahnya harus sama dengan order yang
  disimpan. Mengirim notifikasi palsu tidak bisa melunasi invoice.
- **Jumlah dihitung server:** pelanggan tidak bisa mengubah nominal yang dibayar.
- **Tidak ada pencatatan ganda:** notifikasi ganda atau bersamaan hanya mencatat satu pembayaran.
- **Tanda tangan dicek dulu:** hanya permintaan dengan tanda tangan salah/payload rusak yang
  dibatasi per IP (429). Notifikasi Midtrans yang sah tidak pernah diblokir rate limit.
- **Order lama dihentikan:** bila sisa tagihan berubah (pembayaran manual, refund) atau invoice
  lunas/dibatalkan, order Midtrans yang masih tertunda di-expire (`/v2/<order>/expire`, best-effort)
  agar pelanggan tidak membayar lebih.
- **Key harus cocok dengan mode:** key sandbox (`SB-…`) dengan `MIDTRANS_PRODUCTION=true` (atau
  sebaliknya) membuat gateway nonaktif, dan Pengaturan menampilkan peringatan.
- **Parameter di URL kembali** (`?order_id=…&transaction_status=…`) diabaikan; halaman hanya
  menampilkan "sedang diproses" sampai notifikasi terverifikasi masuk.
- Tombol bayar dibatasi per tautan dan per IP; order tertunda dipakai ulang.

### 12. FAQ

**Apakah pelanggan bisa membayar sebagian?** Tidak lewat gateway: tombol selalu menagih seluruh
sisa. Untuk cicilan, catat pembayaran manual atau pakai transfer + bukti (v24).

**Berapa lama order berlaku?** 24 jam. Klik ulang dalam masa itu memakai order yang sama.

**Apakah biaya Midtrans dicatat?** Belum. Dompetku mencatat jumlah kotor. Catat biaya MDR sebagai
pengeluaran "Biaya Admin" bila perlu.

**Bisa pakai transfer + bukti dan Midtrans sekaligus?** Bisa. Keduanya tampil di halaman publik.

**Bagaimana backup?** Riwayat `gateway_transactions` ikut backup (tanpa token pembayaran). Kunci
Midtrans tidak ikut backup; isi ulang setelah restore ke instance baru.

**Apakah ada di demo publik?** Tidak, pembayaran online selalu nonaktif di demo.

### 13. Batasan

- Satu provider (Midtrans Snap), mata uang IDR, nominal bilangan bulat rupiah.
- Selalu menagih seluruh sisa tagihan; tidak ada pembayaran sebagian lewat gateway.
- Refund otomatis hanya untuk metode yang didukung Midtrans; sisanya manual.
- Biaya transaksi (MDR) tidak dicatat otomatis.
- Chargeback dicatat sebagai refund dan baru terlihat setelah **Cek status** atau notifikasi.
- Order dibuat di lingkungan sandbox tidak bisa dicek setelah pindah ke production.

---

## English

### 1. What is it for?

Without a gateway, customers pay by manual transfer and upload a proof that you verify (v24). With
Midtrans, the customer clicks **Bayar sekarang** (Pay now) on the public invoice page, pays on
Midtrans' page, and the invoice is marked paid **automatically** once Midtrans confirms it.

```
Customer                 Dompetku                         Midtrans
   |  open /i/<token>       |                                  |
   |----------------------->|                                  |
   |  click "Pay now"       |  create order (amount = due)     |
   |----------------------->|--------------------------------->|
   |      Snap page         |<------- token + redirect_url ----|
   |<-----------------------|                                  |
   |  pay (QRIS/card/VA) ------------------------------------->|
   |                        |<-- notification (webhook) -------|
   |                        |  verify signature                |
   |                        |  re-check status via API ------->|
   |                        |<-------------- real status ------|
   |                        |  book payment (income "Invoice") |
   |                        |  send confirmation email (opt.)  |
   |  invoice shows Paid    |                                  |
```

Every successful payment is booked as **income in category "Invoice"** on the invoice wallet,
exactly like a manual payment.

### 2. Prerequisites

1. **Schema v25** has been run: Supabase → SQL Editor, paste the whole `supabase/schema.sql`, Run
   (safe to repeat). v25 needs v21, v23 and v24.
2. **Public invoice links** work (v23); the pay button lives on the public page.
3. **`SESSION_SECRET`** (≥ 32 chars) is set; rate limiting and stored secrets need it.
4. A **Midtrans account** (<https://dashboard.midtrans.com>). New accounts get **sandbox**
   (testing, no real money). Production needs business verification by Midtrans.
5. Your instance is publicly reachable over **HTTPS**. Midtrans cannot notify `localhost`.

> [!TIP]
> Always start in **sandbox**. Switch to production only after one test payment was recorded
> automatically.

### 3. Get the Server Key and Client Key

1. Log in to <https://dashboard.midtrans.com>.
2. Pick the environment (top left): **Sandbox** or **Production**.
3. Open **Settings → Access Keys**.
4. Copy the **Server Key** (sandbox: `SB-Mid-server-…`, **secret**) and the **Client Key**
   (sandbox: `SB-Mid-client-…`, public, used in the customer's browser).

Sandbox and production keys are **different**; never mix them.

### 4. Fill in Settings → Integrasi

Sign in as admin → **Settings → Integrasi → Payment gateway (Midtrans)**:

| Field                 | Value                                      |
| --------------------- | ------------------------------------------ |
| `MIDTRANS_SERVER_KEY` | Server Key from step 3                     |
| `MIDTRANS_CLIENT_KEY` | Client Key from step 3                     |
| `MIDTRANS_PRODUCTION` | `false` (sandbox) first                    |
| `MIDTRANS_ENABLED`    | `true` once the three fields above are set |

The Server Key is stored encrypted and never shown again (only its last 4 characters). Changes
apply within about a minute.

**Via env instead** (Vercel → Settings → Environment Variables, then Redeploy): set variables with
the same names. Values saved in Settings win over env. See
[ENVIRONMENT.md](ENVIRONMENT.md#payment-gateway-midtrans-optional).

### 5. Set the Notification URL and Finish URL

In the Midtrans dashboard (same environment as your keys) → **Settings → Configuration** (on some
accounts **Settings → Payment → Notification URL**):

| Field                        | Value                                                     |
| ---------------------------- | --------------------------------------------------------- |
| **Payment Notification URL** | `https://dompet.example.com/api/public/payments/midtrans` |
| **Finish Redirect URL**      | `https://dompet.example.com/` (optional, see note)        |

Click **Update**.

- The Notification URL is **required**: `https://`, standard port, no login.
- Finish URL: when `PUBLIC_SITE_URL=https://dompet.example.com` is set, Dompetku sends a return
  address per payment (`/i/<token>?gw=1`), which takes precedence. **Without `PUBLIC_SITE_URL`**
  Dompetku sends none (the request Host header is not trusted) and Midtrans uses the **Finish
  Redirect URL** from its dashboard; set it to your domain.

### 6. Test in sandbox

1. Create and issue an invoice, create its public link (**Rincian → Bagikan**) and open it in a
   private window.
2. Click **Bayar sekarang**; the Midtrans payment page opens.
3. Pick e.g. **QRIS** or **GoPay** and "pay" it with the Midtrans **sandbox simulator**
   (<https://simulator.sandbox.midtrans.com>), or use a sandbox test card from the Midtrans docs.
4. Within seconds the invoice becomes **Lunas** (paid) or **Dibayar sebagian** (partial); the
   invoice details show a payment with method `Midtrans (…)` and a **Transaksi Midtrans** section.
5. **Transaksi** shows an income in category "Invoice".

If nothing changes, use **Rincian → Transaksi Midtrans → Cek status**: it reads the status directly
from Midtrans (useful when a notification was missed).

### 7. Go to production

1. Make sure your Midtrans production account is active.
2. In the **Production** dashboard copy the production Server Key and Client Key (no `SB-` prefix).
3. Set the same Notification URL in the **Production** environment.
4. In Settings → Integrasi replace both keys and set `MIDTRANS_PRODUCTION` to `true`.
5. Make one small real payment, refund it if you like.

Old sandbox orders stay in the history but can no longer be re-checked with production keys.

### 8. Refunds

In **Invoice → Rincian → Transaksi Midtrans**, **Refund** appears for successful, refundable
payments. Enter an amount (empty = everything left) and a reason, then confirm.

- **Refundable through Midtrans:** credit/debit card, GoPay, ShopeePay, QRIS, DANA, OVO, Kredivo,
  Akulaku. ShopeePay and OVO support **full refunds only**.
- **Not refundable:** bank transfer / virtual account, convenience stores, etc. Return the money
  yourself and record it manually.
- Only payments in **settlement** at Midtrans. Cards that are only `capture` (usually settle the
  next day) must wait.
- Refund windows differ per method (from 7 days); see the Midtrans docs.

What Dompetku does on a refund:

- **Nothing is deleted.** The original payment stays.
- A **reversing expense** in category "Invoice" is booked on the same wallet.
- The invoice's paid amount goes down (also in reports and on the public page), so its status
  returns to **partial** or **unpaid**.
- **Billing is put on hold:** after a refund the **Bayar sekarang** button is hidden and due
  reminders are not sent, so a customer who was just refunded is not billed again. Under
  **Transaksi Midtrans** choose either:
  - **Batalkan invoice** (cancel; the normal action once payments are removed/fully refunded)
    when the customer does not need to pay again; or
  - **Tagih ulang** (bill again) when the amount due really must be paid (button and reminders
    come back).
- Refunds made directly in the Midtrans dashboard are recorded too, when the `refund` /
  `partial_refund` notification arrives or when you click **Cek status**.

### 9. Statuses

| Dompetku status (EN UI) | Midtrans status                                 | Meaning                                                 |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| Awaiting payment        | `pending`, `authorize`, `capture` + `challenge` | Order created, customer has not finished / under review |
| Succeeded               | `settlement`, `capture` + `accept`              | Money received, payment booked                          |
| Failed                  | `deny`, `cancel`, `failure`                     | Rejected or cancelled, no money                         |
| Expired                 | `expire`                                        | Not paid before the deadline (24 h)                     |
| Partially refunded      | `partial_refund`                                | Part of the money was returned                          |
| Refunded                | `refund`                                        | All of the money was returned                           |

Late notifications never downgrade a status: e.g. an `expire` after `settlement` is ignored, so a
paid invoice is never undone by the order notifications arrive in.

### 10. Troubleshooting

| Symptom                                      | Cause & fix                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No **Bayar sekarang** button                 | Check: v25 run; `MIDTRANS_ENABLED=true`; Server Key set; invoice unpaid/partial; amount due is whole rupiah (no cents); not a demo instance.                                                      |
| Click → "Could not start the online payment" | Wrong Server Key or sandbox/production mix-up (`SB-…` only with `MIDTRANS_PRODUCTION=false`). Check server logs (`gateway:create`).                                                               |
| Webhook never arrives                        | Notification URL wrong / saved in the other environment; domain not public; HTTPS issue. In the Midtrans dashboard open the transaction → **Notification history**. Meanwhile use **Cek status**. |
| Webhook answered **401**                     | Signature mismatch: the Server Key in Dompetku is not the one of the sending account/environment.                                                                                                 |
| Webhook answered **503**                     | Gateway off (including a key/mode mismatch) or v25 not run. Midtrans retries.                                                                                                                     |
| Pay button gone after a refund               | By design: the invoice is on hold after a refund. Use **Transaksi Midtrans → Tagih ulang** or cancel the invoice.                                                                                 |
| Webhook answered **403**                     | Demo instance (`DEMO_MODE=true`): online payments are always off.                                                                                                                                 |
| Succeeded but invoice unchanged              | See the red note under **Transaksi Midtrans**, e.g. the invoice was paid/cancelled first or the amount did not match. The money did arrive: refund it or record it manually.                      |
| Invoice cannot be deleted                    | It has a pending or successful Midtrans order. Cancel the invoice instead; payment history must not disappear.                                                                                    |
| Midtrans payment cannot be deleted           | By design. Use **Refund**.                                                                                                                                                                        |

### 11. Security notes

- **Write-only Server Key:** encrypted at rest (AES-256-GCM), never sent to the browser, never in
  backups. The browser only gets the (public) Client Key and a payment token.
- **Notifications are not trusted as-is:** the SHA-512 signature is checked, then status and amount
  are **always re-read from the Midtrans API** and the amount must equal the stored order. A forged
  notification cannot mark an invoice paid.
- **Server-computed amount:** customers cannot change what they pay.
- **No double booking:** duplicate or concurrent notifications book one payment only.
- **Signature first:** only requests with a bad signature or payload are rate limited per IP
  (429). Genuine Midtrans notifications are never blocked by the rate limit.
- **Old orders are stopped:** when the amount due changes (manual payment, refund) or the invoice
  is paid/cancelled, still-pending Midtrans orders are expired (`/v2/<order>/expire`, best effort)
  so the customer cannot overpay.
- **Key must match the mode:** a sandbox key (`SB-…`) with `MIDTRANS_PRODUCTION=true` (or the
  reverse) keeps the gateway off, and Settings shows a warning.
- **Return URL parameters** (`?order_id=…&transaction_status=…`) are ignored; the page only says
  "being processed" until a verified notification arrives.
- The pay button is rate limited per link and per IP; pending orders are reused.

### 12. FAQ

**Can customers pay part of the invoice?** Not through the gateway: it always charges the full
amount due. For instalments record payments manually or use transfer + proof (v24).

**How long is an order valid?** 24 hours; clicking again within that time reuses the same order.

**Are Midtrans fees recorded?** Not yet. Dompetku books the gross amount; record the MDR as a
"Biaya Admin" expense if you need it.

**Transfer + proof and Midtrans together?** Yes, both show on the public page.

**Backups?** `gateway_transactions` history is backed up (without payment tokens). Midtrans keys
are not; re-enter them after restoring onto a new instance.

**On the public demo?** No, online payments are always off in demo mode.

### 13. Limitations

- One provider (Midtrans Snap), IDR only, whole-rupiah amounts.
- Always charges the whole amount due; no partial payments through the gateway.
- Automatic refunds only for methods Midtrans supports; the rest are manual.
- Transaction fees (MDR) are not booked automatically.
- Chargebacks are recorded as refunds and appear after **Cek status** or a notification.
- Sandbox orders cannot be re-checked after switching to production.
