# Notifikasi bank via MacroDroid — panduan / guide

**Bahasa Indonesia** · [English](#english)

Dompetku bisa membaca **notifikasi uang masuk** dari aplikasi bank atau e-wallet di HP Android Anda,
lalu mencocokkannya dengan invoice yang belum lunas. HP meneruskan notifikasi lewat aplikasi
**MacroDroid** (gratis di Play Store). Tidak perlu API bank dan tidak perlu bisa coding.

> **Penting.** Notifikasi bisa dipalsukan oleh aplikasi lain di HP, atau oleh siapa pun yang tahu
> token perangkat. Karena itu, notifikasi yang cocok **hanya menandai** invoice sebagai
> **Menunggu verifikasi**. Anda yang menekan **Konfirmasi**. Konfirmasi otomatis tersedia, tetapi
> mati secara default.

## Daftar isi

1. [Cara kerja](#1-cara-kerja)
2. [Yang perlu disiapkan](#2-yang-perlu-disiapkan)
3. [Aktifkan di Dompetku](#3-aktifkan-di-dompetku)
4. [Atur format notifikasi](#4-atur-format-notifikasi)
5. [Buat makro di MacroDroid](#5-buat-makro-di-macrodroid)
6. [Uji coba](#6-uji-coba)
7. [Memeriksa dan mengonfirmasi](#7-memeriksa-dan-mengonfirmasi)
8. [Pemecahan masalah](#8-pemecahan-masalah)
9. [Keamanan dan privasi](#9-keamanan-dan-privasi)

## 1. Cara kerja

```
Pelanggan transfer ─► Aplikasi bank di HP ─► notifikasi "Dana masuk Rp 150.123"
                                                │ MacroDroid (trigger Notifikasi)
                                                ▼
                     POST https://<domain>/api/public/payments/notify  (token perangkat)
                                                │
              Dompetku: format cocok? → nominal → invoice dengan sisa + kode unik = nominal
                                                │
                       1 invoice → "Menunggu verifikasi" (antrean Notifikasi bank)
                       >1 invoice → "Ambigu"  ·  tidak ada → "Tidak cocok"
```

**Kode unik.** Setiap invoice terbuka mendapat angka 1–999 rupiah. Angka ini ditambahkan ke
jumlah transfer, misalnya sisa Rp 150.000 + kode 123 = **Rp 150.123**. Dengan begitu, dua
pelanggan dengan tagihan sama tetap bisa dibedakan. Kode dan jumlah transfer tampil di halaman
invoice publik (`/i/<token>`) dan di email invoice. Saat dikonfirmasi, sisa tagihan dicatat
sebagai pembayaran invoice, sedangkan kode unik dicatat sebagai pemasukan kecil terpisah di
kategori "Invoice".

## 2. Yang perlu disiapkan

1. **Skema v26** sudah dijalankan. Buka Supabase → SQL Editor, tempel seluruh `supabase/schema.sql`,
   lalu Run (aman diulang). v26 butuh v21 dan v24.
2. HP **Android** yang menerima notifikasi dari aplikasi bank/e-wallet Anda. HP ini sebaiknya
   khusus untuk usaha dan selalu terhubung internet.
3. **MacroDroid** dari Play Store. Versi gratis cukup untuk satu makro.
4. Instance Dompetku bisa diakses publik lewat **HTTPS**.

## 3. Aktifkan di Dompetku

Masuk sebagai admin, lalu buka **Pengaturan → Integrasi → Notifikasi bank (MacroDroid)**:

| Pengaturan                | Isi                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MACRODROID_TOKEN`        | Token acak minimal 32 karakter (huruf, angka, `-`, `_`). Contoh: jalankan `openssl rand -hex 24`. Disimpan terenkripsi, tidak pernah tampil lagi.       |
| `MACRODROID_AUTO_CONFIRM` | `false` (disarankan). Pilih `true` hanya jika Anda menerima risikonya, karena notifikasi palsu bisa langsung tercatat sebagai pembayaran.               |
| `MACRODROID_GENERIC`      | `true` = notifikasi yang tidak cocok dengan format mana pun tetap dicoba dengan pola "Rp …" + kata uang masuk. Bagus untuk mulai, tetapi lebih longgar. |

Tanpa token, endpoint menjawab **503** dan kode unik tidak dibuat.

## 4. Atur format notifikasi

Setiap bank menulis notifikasi dengan cara berbeda, dan formatnya bisa berubah saat aplikasi
diperbarui. Karena itu, format **diatur sendiri** di **Pengaturan → Format notifikasi bank**.

1. Pilih contoh (BCA, Mandiri, BRI, BNI, DANA, OVO, GoPay, ShopeePay), lalu klik **Tambah contoh**.
   Contoh ini **belum diverifikasi** dengan notifikasi asli. Sesuaikan dengan notifikasi Anda.
2. Klik ✏️ pada format untuk mengubah isiannya:
   - **Aplikasi**: potongan nama paket atau nama aplikasi, dipisah koma (mis. `com.bca, BCA`).
     Nama paket bisa dilihat di MacroDroid, di daftar aplikasi pada trigger Notifikasi, atau di
     log sistem MacroDroid setelah notifikasi masuk.
   - **Judul / Teks notifikasi** (opsional): harus _mengandung_ teks tertentu, atau cocok dengan
     _regex_.
   - **Regex nominal**: pola untuk mengambil nominal. Isi dengan grup bernama `(?<amount>…)` atau
     grup pertama. Pola bawaan `(?:Rp\.?|IDR)\s?(?<amount>\d[\d.,]*)` mengenali `Rp 1.250.000,00`,
     `Rp1.250.000`, `IDR1,250,000.00`, dan `Rp. 50.000`.
   - **Wajib mengandung salah satu**: kata uang masuk (mis. `masuk, diterima, kredit`).
   - **Abaikan bila mengandung**: mis. `keluar, debit, transfer ke, OTP`.
   - **Dompet invoice** (opsional): hanya invoice ke dompet ini yang dicocokkan. Gunakan ini bila
     Anda punya beberapa rekening.
3. Format dicoba **berurutan**, dan format pertama yang cocok dengan aplikasi/judul/teks dipakai.

**Uji teks contoh.** Tempel notifikasi asli dengan nama dan nomor yang sudah disamarkan, beserta
aplikasinya. Dompetku langsung menunjukkan format yang cocok dan nominal yang terbaca. Pengujian
ini berjalan di browser dan tidak mengirim apa pun. Kotak yang sama juga ada di dialog edit,
untuk menguji satu format saja.

**Batas regex (demi keamanan server):** maksimal 200 karakter, harus valid, dan tanpa
backreference/lookbehind. Pola bersarang seperti `(a+)+` atau `(a|b)*` ditolak, begitu pula lebih
dari 3 `*`/`+`. Regex hanya dijalankan pada 600 karakter pertama notifikasi.

## 5. Buat makro di MacroDroid

Buka MacroDroid → **Add Macro** (tombol +), lalu isi:

```
Nama makro: Dompetku – notifikasi bank

TRIGGERS
  Notification → Notification Received
    Select Applications → (centang aplikasi bank/e-wallet Anda) → Include
    Text content: Any text      (penyaringan dilakukan di Dompetku)
    [x] Ignore ongoing/persistent notifications
    [x] Prevent multiple triggers

ACTIONS
  Web Interactions → HTTP Request
    Settings:
      Request method: POST
      URL: https://<domain-anda>/api/public/payments/notify
      Timeout: 30
      [ ] Allow any certificate      (biarkan mati)
      Save HTTP return code in integer variable: http_code   (opsional)
    Header Params:
      Authorization = Bearer <MACRODROID_TOKEN Anda>
    Content Body:
      Content type: application/json
      Text:
        {"app":"{not_app_name}","package":"{not_app_package}","title":"{not_title}",
         "text":"{notification}","big_text":"{not_text_big}","sub_text":"{not_sub_text}",
         "posted_at":"{not_timestamp}","device":"HP Toko"}
```

- Isi `"device"` dengan nama bebas, misalnya nama HP. Nama ini tampil di antrean.
- Magic text `{not_app_name}`, `{not_app_package}`, `{not_title}`, `{notification}`,
  `{not_text_big}`, `{not_sub_text}`, dan `{not_timestamp}` berasal dari trigger Notification.
  Nilai yang tidak tersedia (mis. big text kosong) akan diabaikan oleh Dompetku.
- **Tanda kutip di notifikasi.** Bila teks notifikasi berisi `"` atau baris baru, JSON bisa
  rusak, dan Dompetku akan menjawab 400. Cara yang lebih tahan adalah membuat _Dictionary_
  lokal `payload`. Isi key `app`, `package`, `title`, `text`, `big_text`, `posted_at`, dan
  `device` dengan magic text di atas lewat **Set Variable**, lalu isi Content Body dengan
  `{lvjson=payload}`. MacroDroid akan menulis JSON yang valid.
- Simpan makro dan pastikan **izin Notification Access** untuk MacroDroid aktif. Matikan juga
  penghematan baterai untuk MacroDroid.

## 6. Uji coba

1. Buat invoice, terbitkan, lalu buka tautan publiknya. Di bagian "Cara membayar" tampil
   **Jumlah transfer** (sisa + kode unik).
2. Transfer nominal itu dari rekening lain. Bisa juga dengan uji tanpa uang: kirim notifikasi uji
   dari komputer:

   ```sh
   curl -X POST https://<domain>/api/public/payments/notify \
     -H "Authorization: Bearer <MACRODROID_TOKEN>" -H "Content-Type: application/json" \
     -d '{"app":"BCA","package":"com.bca","title":"Dana Masuk","text":"Rp 150.123,00 dari BUDI"}'
   ```

   Jawaban `{"ok":true,"status":"matched"}` berarti cocok dengan satu invoice.

3. Buka **Invoice**. Kartu **Notifikasi bank** menampilkan notifikasi tersebut, dan invoice
   berstatus **Menunggu verifikasi**.

## 7. Memeriksa dan mengonfirmasi

Di **Invoice → Notifikasi bank** (filter _Perlu dicek_):

- **Menunggu verifikasi**: tepat satu invoice cocok. Cek mutasi rekening, lalu klik **Konfirmasi**.
- **Ambigu**: lebih dari satu invoice punya nominal sama. Pilih invoice yang benar di dialog.
- **Tidak cocok**: tidak ada invoice dengan nominal itu, misalnya pelanggan lupa kode unik atau
  membayar sebagian. Pilih invoice dan ubah jumlahnya bila perlu.
- **Abaikan**: notifikasi bukan pembayaran invoice.

Konfirmasi mencatat pembayaran invoice (pemasukan kategori "Invoice", referensi `signal:…`),
mencatat kode unik sebagai pemasukan tambahan bila nominalnya pas, lalu mengirim email konfirmasi
ke pelanggan (bila Resend aktif). Klik ganda atau dua tab tidak pernah mencatat dua kali.

## 8. Pemecahan masalah

| Gejala                                           | Penyebab / solusi                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jawaban **401**                                  | Token salah. Header harus `Authorization: Bearer <token>` (dengan spasi) atau `X-Device-Token: <token>`. Terlalu banyak token salah dari satu IP → **429**.         |
| Jawaban **503**                                  | `MACRODROID_TOKEN` belum diatur, v26 belum dijalankan, atau gangguan sementara (MacroDroid boleh mencoba lagi).                                                     |
| Jawaban **403**                                  | Instance demo; fitur ini mati di demo.                                                                                                                              |
| Jawaban **400**                                  | Body bukan JSON yang valid (tanda kutip/baris baru di notifikasi; pakai cara `{lvjson=payload}`) atau judul dan teks kosong.                                        |
| Jawaban **413**                                  | Body lebih dari 16 KB.                                                                                                                                              |
| Status **ignored** "Tidak ada format yang cocok" | Tambah/ubah format, cek isian **Aplikasi**, atau aktifkan `MACRODROID_GENERIC`.                                                                                     |
| "Tidak ada kata kunci uang masuk"                | Tambah kata dari notifikasi Anda ke **Wajib mengandung salah satu**.                                                                                                |
| "Nominal tidak ditemukan"                        | Sesuaikan **Regex nominal**; uji dengan **Uji teks contoh**.                                                                                                        |
| Selalu **Tidak cocok**                           | Pelanggan tidak mentransfer jumlah persis (sisa + kode unik), atau invoice dibuat setelah notifikasi. Pilih invoice manual saat konfirmasi.                         |
| Makro tidak jalan                                | Izin Notification Access, optimasi baterai, atau notifikasi bank disembunyikan Android (Android 15 bisa menyembunyikan konten sensitif). Cek log sistem MacroDroid. |
| Notifikasi sama terkirim dua kali                | Aman: notifikasi dengan isi dan waktu sama di-dedupe (`duplicate: true`).                                                                                           |

## 9. Keamanan dan privasi

- Token perangkat dibandingkan sebagai hash dengan waktu konstan, **sebelum** rate limit atau akses
  database. Hanya permintaan dengan token salah yang dibatasi per IP, jadi IP palsu tidak bisa
  memblokir HP Anda. Perangkat yang sah dibatasi 120 permintaan/jam dan 1500/hari. Ganti token
  (rotate) di Pengaturan bila HP hilang.
- Dompetku **tidak menyimpan** payload mentah. Yang disimpan hanya cuplikan satu baris (≤300
  karakter) dengan deretan angka ≥6 digit disamarkan, plus nominal, aplikasi, waktu, dan status.
  Notifikasi yang diabaikan atau tidak cocok dihapus otomatis setelah ±90 hari. Data ini tidak ikut
  backup.
- Notifikasi lebih lama dari 48 jam (dari `{not_timestamp}`) diabaikan.
- Teruskan hanya aplikasi bank/e-wallet. Jangan teruskan aplikasi chat, karena teks chat bisa
  ditulis siapa saja.

Dokumentasi resmi MacroDroid yang dipakai: [Trigger: Notification](https://wiki.macrodroid.com/wiki/index.php/Trigger:_Notification),
[Action: HTTP Request](https://wiki.macrodroid.com/wiki/index.php?title=Action:_HTTP_Request),
[Magic text](https://wiki.macrodroid.com/wiki/index.php?title=Magic_text),
[Dictionaries and Arrays](https://wiki.macrodroid.com/wiki/index.php?title=Dictionaries_and_Arrays).

---

## English

Dompetku can read **incoming-money notifications** from bank or e-wallet apps on your Android
phone and match them with unpaid invoices. The phone forwards them with **MacroDroid** (free on
the Play Store). No bank API and no coding are needed.

> **Important.** Other apps on the phone, or anyone who knows the device token, can fake a
> notification. That is why a match only marks the invoice **Menunggu verifikasi** (Awaiting
> verification), and you press **Confirm**. Auto-confirm exists, but it is off by default.

### 1. How it works

The phone posts each notification to `POST https://<domain>/api/public/payments/notify` with
the device token. Dompetku finds the first matching **format**, reads the amount, and looks for
the open invoice whose **amount due + unique code** equals it:

- one invoice → _Awaiting verification_;
- more than one → _Ambiguous_;
- none → _No match_.

**Unique code.** Every open invoice gets 1–999 rupiah added to the transfer, for example
Rp 150,000 + 123 = **Rp 150,123**. The code is shown on the public invoice page and in invoice
emails. When you confirm, the amount due is booked as the invoice payment, and the code is booked
as a separate small income in category "Invoice".

### 2. Prerequisites

1. **Schema v26** has been run (Supabase → SQL Editor → paste the whole `supabase/schema.sql` →
   Run; safe to repeat). v26 needs v21 and v24.
2. An **Android** phone that receives your bank/e-wallet notifications, ideally a dedicated phone
   that is always online.
3. **MacroDroid** from the Play Store. The free tier is enough for one macro.
4. Your Dompetku instance is reachable over public **HTTPS**.

### 3. Turn it on

In **Settings → Integrations → Bank notifications (MacroDroid)**:

- **`MACRODROID_TOKEN`**: a random token of 32+ characters (letters, digits, `-`, `_`), e.g. from
  `openssl rand -hex 24`. It is stored encrypted and never shown again. Without it the endpoint
  answers 503 and no unique codes are created.
- **`MACRODROID_AUTO_CONFIRM`**: `false` (recommended). With `true`, a faked notification is
  booked as paid immediately.
- **`MACRODROID_GENERIC`**: with `true`, notifications that match no format are still tried with
  a generic "Rp …" pattern plus incoming-money keywords.

### 4. Notification formats

Every bank words its notifications differently, and the wording changes with app updates.
Manage formats in **Settings → Format notifikasi bank** (Bank notification formats):

1. Pick an example (BCA, Mandiri, BRI, BNI, DANA, OVO, GoPay, ShopeePay) → **Add example**. These
   are **unverified examples**: adjust them to your real notifications.
2. Edit a format to set:
   - **App**: package or app name parts, comma-separated.
   - Optional **title/text** filter: _contains_ or _regex_.
   - **Amount regex**: a named group `(?<amount>…)` or the first group holds the amount. The
     default pattern reads `Rp 1.250.000,00`, `IDR1,250,000.00` and `Rp. 50.000`.
   - **Must contain one of**: incoming-money keywords.
   - **Ignore if it contains**: e.g. outgoing money or OTP wording.
   - Optional **invoice wallet**: only invoices into that wallet are matched.
3. Formats are tried in order, and the first one matching app/title/text wins.

**Test with sample text.** Paste a real notification (mask names and numbers). The card shows the
matched format and the parsed amount right away. This runs in your browser and sends nothing.

**Regex limits (to protect the server):**

- at most 200 characters, and the pattern must compile;
- no backreferences or lookbehind;
- nested or alternating quantified groups like `(a+)+` are rejected;
- at most 3 `*`/`+`;
- patterns only run on the first 600 characters of a notification.

### 5. The macro

```
TRIGGER  Notification → Notification Received → Select Applications (your bank apps, Include)
         Text content: Any text · Ignore ongoing notifications · Prevent multiple triggers
ACTION   Web Interactions → HTTP Request
         POST https://<your-domain>/api/public/payments/notify
         Header Params: Authorization = Bearer <MACRODROID_TOKEN>
         Content Body (application/json):
         {"app":"{not_app_name}","package":"{not_app_package}","title":"{not_title}",
          "text":"{notification}","big_text":"{not_text_big}","sub_text":"{not_sub_text}",
          "posted_at":"{not_timestamp}","device":"Shop phone"}
```

If a notification contains quotes or line breaks, a hand-written JSON body breaks (400). The
robust variant:

1. Fill a local dictionary `payload` with **Set Variable**, using the same keys and magic text.
2. Send `{lvjson=payload}` as the content body. MacroDroid then writes valid JSON.

Grant MacroDroid **Notification Access**, and exclude it from battery optimisation.

### 6. Test

Open an issued invoice's public link and note the **Amount to transfer**. Then either transfer
that amount, or send a test notification without moving money:

```sh
curl -X POST https://<domain>/api/public/payments/notify \
  -H "Authorization: Bearer <MACRODROID_TOKEN>" -H "Content-Type: application/json" \
  -d '{"app":"BCA","package":"com.bca","title":"Dana Masuk","text":"Rp 150.123,00 dari BUDI"}'
```

`{"ok":true,"status":"matched"}` means one invoice matched. It then appears in **Invoice → Bank
notifications** as _Awaiting verification_.

### 7. Review

In **Invoice → Bank notifications**:

- **Confirm** a match, or pick the right invoice for _Ambiguous_ / _No match_ rows (you can edit
  the amount).
- **Ignore** anything that is not an invoice payment.

Confirming books the payment once: a double click or a second tab never books twice. It also
books the unique code as extra income when the amount is exact, and sends the customer a
confirmation email (best effort).

### 8. Troubleshooting

| Answer / symptom            | Cause / fix                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 401 / 429                   | Wrong token (`Authorization: Bearer <token>` or `X-Device-Token`); too many wrong tokens from one IP give 429.              |
| 503                         | No `MACRODROID_TOKEN`, v26 not run, or a transient error.                                                                   |
| 403                         | Demo instance.                                                                                                              |
| 400 / 413                   | Invalid JSON (use `{lvjson=payload}`) or empty title and text / body over 16 KB.                                            |
| ignored "No format matches" | Add or fix a format (check **App**) or enable `MACRODROID_GENERIC`.                                                         |
| "No incoming-money keyword" | Add your bank's wording to **Must contain one of**.                                                                         |
| "Amount not found"          | Adjust the **Amount regex**, test with **Test with sample text**.                                                           |
| Always "No match"           | The customer did not transfer the exact amount due + code; pick the invoice by hand.                                        |
| Macro does not fire         | Notification Access, battery optimisation, Android 15 hiding sensitive notification content; check MacroDroid's system log. |

### 9. Security and privacy

- The device token is compared as a hash in constant time, **before** any rate limit or database
  access.
- Only wrong-token requests are limited per IP, so a spoofed IP cannot block your phone. A valid
  device is limited to 120 requests/hour and 1500/day. Rotate the token in Settings if the phone
  is lost.
- The raw payload is **never stored**. Dompetku keeps only:
  - a one-line excerpt (≤ 300 characters) with digit runs of 6+ masked;
  - the amount, app, time and status.
- Ignored and unmatched rows are pruned after about 90 days, and none of this is backed up.
- Notifications older than 48 hours are ignored.
- Forward only bank/e-wallet apps, never chat apps.

Official MacroDroid documentation used: [Trigger: Notification](https://wiki.macrodroid.com/wiki/index.php/Trigger:_Notification),
[Action: HTTP Request](https://wiki.macrodroid.com/wiki/index.php?title=Action:_HTTP_Request),
[Magic text](https://wiki.macrodroid.com/wiki/index.php?title=Magic_text),
[Dictionaries and Arrays](https://wiki.macrodroid.com/wiki/index.php?title=Dictionaries_and_Arrays).
