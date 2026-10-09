/**
 * Dev-only HTML templates for the social card (og-image) and the README banner, rendered by
 * scripts/render-icons.mjs. Colors mirror the light theme tokens in src/styles.css; every amount
 * is fake demo data.
 */

const C = {
  bg: "oklch(0.972 0.012 85)",
  dot: "oklch(0.86 0.02 90)",
  card: "oklch(0.995 0.004 85)",
  border: "oklch(0.895 0.015 90)",
  fg: "oklch(0.22 0.03 165)",
  muted: "oklch(0.5 0.025 160)",
  soft: "oklch(0.945 0.012 85)",
  primary: "oklch(0.43 0.09 163)",
  primarySoft: "oklch(0.93 0.035 163)",
  ink: "#1d3b2f",
  cream: "oklch(0.98 0.01 85)",
  gold: "oklch(0.78 0.13 82)",
  goldSoft: "oklch(0.95 0.05 85)",
  goldInk: "oklch(0.45 0.09 70)",
  income: "oklch(0.55 0.12 155)",
  expense: "oklch(0.6 0.16 35)",
  expenseSoft: "oklch(0.95 0.035 35)",
  warning: "oklch(0.74 0.15 75)",
  blueSoft: "oklch(0.94 0.03 230)",
  blue: "oklch(0.5 0.09 230)",
};

/** Shared CSS: fonts, dotted background and the feature-card primitives. */
export function baseCss(font) {
  return `
  @font-face{font-family:"Bricolage Grotesque";font-weight:200 800;src:url(${font("bricolage-grotesque-latin-opsz-normal.woff2")})}
  @font-face{font-family:Figtree;font-weight:300 900;src:url(${font("figtree-latin-wght-normal.woff2")})}
  @font-face{font-family:"JetBrains Mono";font-weight:100 800;src:url(${font("jetbrains-mono-latin-wght-normal.woff2")})}
  *{box-sizing:border-box;margin:0}
  .canvas{position:relative;overflow:hidden;background-color:${C.bg};
    background-image:radial-gradient(${C.dot} 1.3px,transparent 1.4px);background-size:22px 22px;
    font-family:Figtree,sans-serif;color:${C.fg};-webkit-font-smoothing:antialiased}
  .display{font-family:"Bricolage Grotesque",sans-serif}
  .mono{font-family:"JetBrains Mono",monospace;font-variant-numeric:tabular-nums}
  .brand{display:flex;align-items:center;gap:20px}
  .brand img{display:block;border-radius:16px;box-shadow:0 6px 16px -8px #1d3b2f66}
  .brand b{font:700 40px/1 "Bricolage Grotesque";letter-spacing:-1px}
  .brand b i{font-style:normal;color:${C.gold}}
  .eyebrow{font:700 15px/1 Figtree;letter-spacing:3.2px;color:${C.primary};text-transform:uppercase}
  .pill{display:inline-block;background:${C.primary};color:${C.cream};border-radius:10px;
    font:600 21px/1 Figtree;padding:13px 18px}
  .card{position:absolute;background:${C.card};border:1.5px solid ${C.border};border-radius:20px;
    padding:20px 22px;box-shadow:0 10px 30px -18px #1d3b2f40}
  .head{display:flex;align-items:center;gap:12px;font:700 19px/1 Figtree;margin-bottom:16px}
  .ic{width:32px;height:32px;border-radius:9px;background:${C.primarySoft};display:grid;place-items:center}
  .ic svg{width:18px;height:18px;stroke:${C.primary};fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .lbl{font:500 13px/1 Figtree;color:${C.muted}}
  .tag{display:inline-block;border-radius:8px;font:600 13px/1 Figtree;padding:7px 10px}
  .bubble{border-radius:14px;font:500 15px/1.25 Figtree;padding:10px 14px}
  .bar{height:8px;border-radius:99px;background:${C.soft};overflow:hidden}
  .bar>span{display:block;height:100%;border-radius:99px}
  `;
}

const icon = {
  bot: `<svg viewBox="0 0 24 24"><path d="M21 4 3 11l6 2 2 6 3-4 5 4z"/><path d="m9 13 8-6"/></svg>`,
  receipt: `<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>`,
  chart: `<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
  budget: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 5"/></svg>`,
  gold: `<svg viewBox="0 0 24 24"><path d="M3 18h18l-3-7H6zM7 11l2-5h6l2 5"/></svg>`,
};

/** Telegram bot: chat → AI draft → ✅ saved. */
export function botCard(x, y, w) {
  return `<div class="card" style="left:${x}px;top:${y}px;width:${w}px">
    <div class="head"><span class="ic">${icon.bot}</span>Bot Telegram</div>
    <div style="display:flex;justify-content:flex-end"><div class="bubble" style="background:${C.primary};color:${C.cream}">kopi 25rb</div></div>
    <div class="bubble" style="background:${C.soft};margin-top:10px">
      <div style="font-weight:700">Draf transaksi</div>
      <div style="color:${C.muted};font-size:14px;margin-top:3px">Makan &amp; Minum · Dompet</div>
      <div class="mono" style="font-weight:700;color:${C.expense};margin-top:6px">−Rp25.000</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <span class="tag" style="background:${C.primarySoft};color:${C.primary}">✅ Simpan</span>
      <span class="tag" style="background:${C.soft};color:${C.muted}">✏️ Ubah</span>
    </div>
  </div>`;
}

/** Receipt OCR: photo → extracted fields. */
export function ocrCard(x, y, w) {
  return `<div class="card" style="left:${x}px;top:${y}px;width:${w}px">
    <div class="head"><span class="ic">${icon.receipt}</span>OCR nota</div>
    <div style="display:flex;gap:14px;align-items:center">
      <div style="width:52px;height:66px;border-radius:8px;background:${C.soft};border:1.5px dashed ${C.border};padding:9px 8px;display:flex;flex-direction:column;gap:6px">
        <i style="height:4px;border-radius:2px;background:${C.border}"></i><i style="height:4px;width:70%;border-radius:2px;background:${C.border}"></i>
        <i style="height:4px;border-radius:2px;background:${C.border}"></i><i style="height:4px;width:55%;border-radius:2px;background:${C.border}"></i>
      </div>
      <div style="flex:1">
        <div style="font:600 15px/1.2 Figtree">Toko Serba Ada</div>
        <div class="mono" style="font:700 17px/1 'JetBrains Mono';margin-top:7px">Rp187.500</div>
        <div style="display:flex;gap:6px;margin-top:9px">
          <span class="tag" style="background:${C.blueSoft};color:${C.blue}">Belanja</span>
          <span class="tag" style="background:${C.goldSoft};color:${C.goldInk}">3 item</span>
        </div>
      </div>
    </div>
  </div>`;
}

/** Mini dashboard: balance + income/expense + bars. */
export function dashCard(x, y, w) {
  const bars = [
    [46, 30],
    [58, 40],
    [40, 34],
    [66, 38],
    [54, 44],
    [72, 36],
  ];
  return `<div class="card" style="left:${x}px;top:${y}px;width:${w}px">
    <div class="head" style="margin-bottom:12px"><span class="ic">${icon.chart}</span>Dasbor</div>
    <div class="lbl">Total saldo</div>
    <div class="mono" style="font:700 26px/1.1 'JetBrains Mono';letter-spacing:-.5px;margin-top:6px">Rp12.450.000</div>
    <div style="display:flex;gap:18px;margin-top:12px">
      <div><div class="lbl">Pemasukan</div><div class="mono" style="font:700 15px/1 'JetBrains Mono';color:${C.income};margin-top:5px">+8,2 jt</div></div>
      <div><div class="lbl">Pengeluaran</div><div class="mono" style="font:700 15px/1 'JetBrains Mono';color:${C.expense};margin-top:5px">−5,1 jt</div></div>
    </div>
    <div style="display:flex;align-items:flex-end;gap:10px;height:76px;margin-top:14px;border-bottom:1.5px solid ${C.border}">
      ${bars
        .map(
          ([a, b]) =>
            `<div style="flex:1;display:flex;gap:3px;align-items:flex-end"><i style="flex:1;height:${a}px;border-radius:4px 4px 0 0;background:${C.income}"></i><i style="flex:1;height:${b}px;border-radius:4px 4px 0 0;background:${C.expense};opacity:.85"></i></div>`,
        )
        .join("")}
    </div>
  </div>`;
}

/** Budgets with progress bars (ok / near limit / over). */
export function budgetCard(x, y, w) {
  const rows = [
    ["Makan", 62, C.income],
    ["Transport", 86, C.warning],
    ["Hiburan", 100, C.expense],
  ];
  return `<div class="card" style="left:${x}px;top:${y}px;width:${w}px">
    <div class="head"><span class="ic">${icon.budget}</span>Budget</div>
    ${rows
      .map(
        ([n, p, c], i) => `<div style="margin-top:${i ? 12 : 0}px">
        <div style="display:flex;justify-content:space-between;font:600 14px/1 Figtree;margin-bottom:7px"><span>${n}</span><span style="color:${C.muted}">${p}%</span></div>
        <div class="bar"><span style="width:${p}%;background:${c}"></span></div></div>`,
      )
      .join("")}
  </div>`;
}

/** Gold holdings + net worth. */
export function goldCard(x, y, w) {
  return `<div class="card" style="left:${x}px;top:${y}px;width:${w}px">
    <div class="head"><span class="ic" style="background:${C.goldSoft}">${icon.gold.replace("<svg", `<svg style="stroke:${C.goldInk}"`)}</span>Emas &amp; kekayaan</div>
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <span class="lbl">Antam 10 g</span><span class="mono" style="font:700 15px/1 'JetBrains Mono'">Rp19,8 jt</span>
    </div>
    <div style="border-top:1.5px dashed ${C.border};margin:12px 0"></div>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span class="lbl">Kekayaan bersih</span>
      <span class="tag" style="background:${C.primary};color:${C.cream}">Rp48,6 jt</span>
    </div>
  </div>`;
}

const brand = (logo, size) =>
  `<div class="brand"><img src="${logo}" width="${size}" height="${size}"><b>Dompetku<i>.</i></b></div>`;

/** 1200×630 social card: copy on the left, feature collage on the right. */
export function ogHtml({ logo, font }) {
  return `<style>${baseCss(font)}</style>
  <div class="canvas" style="width:1200px;height:630px">
    <div style="position:absolute;left:72px;top:84px;width:520px">
      ${brand(logo, 64)}
      <div class="eyebrow" style="margin-top:64px">Open source · PWA · MIT</div>
      <h1 class="display" style="font-weight:800;font-size:60px;line-height:1.04;letter-spacing:-2px;margin-top:18px">Catat keuangan pribadi dengan rapi</h1>
      <p style="font:400 21px/1.45 Figtree;color:${C.muted};margin-top:20px;width:490px">Bot Telegram, OCR nota, budget, dan emas — data tersimpan di Supabase milik Anda sendiri.</p>
      <div style="margin-top:26px"><span class="pill">dompetku.ilramdhan.dev</span></div>
    </div>
    ${botCard(640, 92, 254)}
    ${ocrCard(640, 368, 254)}
    ${dashCard(910, 52, 254)}
    ${budgetCard(910, 338, 254)}
  </div>`;
}

/** 1600×500 README banner: brand + tagline on the left, wider collage on the right. */
export function bannerHtml({ logo, font }) {
  return `<style>${baseCss(font)}</style>
  <div class="canvas" style="width:1600px;height:500px">
    <div style="position:absolute;left:80px;top:88px;width:600px">
      ${brand(logo, 64)}
      <div class="eyebrow" style="margin-top:46px">Open source · PWA · MIT</div>
      <h1 class="display" style="font-weight:800;font-size:56px;line-height:1.05;letter-spacing:-2px;margin-top:16px">Catat keuangan pribadi dengan rapi</h1>
      <p style="font:400 21px/1.45 Figtree;color:${C.muted};margin-top:18px;width:560px">Bot Telegram, OCR nota, dan laporan — data di Supabase Anda sendiri.</p>
    </div>
    ${botCard(760, 30, 254)}
    ${ocrCard(760, 304, 254)}
    ${dashCard(1030, 108, 254)}
    ${budgetCard(1300, 58, 254)}
    ${goldCard(1300, 274, 254)}
  </div>`;
}

/** Copy for the "what's new in v1.5" card; one template, two languages. Plain words only. */
const WHATS_NEW_V15 = {
  id: {
    eyebrow: "Pembaruan v1.5",
    title: "Apa yang baru?",
    subtitle: "Empat fitur baru: lebih mudah diatur dan bisa dipakai bersama keluarga.",
    f1: {
      title: "Atur bot dari aplikasi",
      body: "Hubungkan bot Telegram langsung dari Pengaturan tanpa mengubah server. Kunci rahasia disimpan terenkripsi dan tidak ditampilkan lagi.",
      rows: [
        ["Token bot Telegram", "•••••••• ✓"],
        ["Chat yang diizinkan", "2 chat"],
        ["Baca nota otomatis", "Aktif"],
      ],
      saved: "Tersimpan aman",
    },
    f2: {
      title: "Halaman Profil",
      body: "Ubah nama, foto, dan alamat Anda, lalu ganti password sendiri kapan saja.",
      name: "Sari Rahma",
      addr: "Jl. Melati 12, Bandung",
      button: "Ganti password",
      photo: "Ganti foto",
    },
    f3: {
      title: "Akun keluarga",
      body: "Tambah anggota keluarga dan pilih dompet mana yang boleh mereka lihat atau kelola.",
      rows: [
        ["Ayah", "Semua dompet", "Pemilik"],
        ["Ibu", "Mandiri, BCA", "Kelola"],
        ["Dika", "Uang Saku", "Lihat saja"],
      ],
      add: "Tambah anggota",
    },
    f4: {
      title: "Kantong di dalam dompet",
      body: "Pisahkan saldo satu dompet untuk tiap keperluan dan dapat peringatan saat kantong menipis atau habis.",
      wallet: "Mandiri",
      pockets: [
        ["Makan", "sisa Rp65rb dari Rp500rb", 87],
        ["Transport", "sisa Rp180rb dari Rp250rb", 28],
      ],
      chat: "kopi 25rb #makan",
      alert: "⚠️ Kantong Makan tinggal Rp65rb",
    },
    footTitle: "Untuk yang sudah pakai",
    steps: [
      "Jalankan ulang file database (<b>schema.sql</b>) sekali.",
      "Sisanya opsional — semua pengaturan lama tetap jalan.",
    ],
  },
  en: {
    eyebrow: "Update v1.5",
    title: "What's new?",
    subtitle: "Four new features: easier to set up, and ready to share with your family.",
    f1: {
      title: "Set up the bot in the app",
      body: "Connect your Telegram bot from Settings, no server changes needed. Secret keys are encrypted and never shown again.",
      rows: [
        ["Telegram bot token", "•••••••• ✓"],
        ["Allowed chats", "2 chats"],
        ["Read receipts automatically", "On"],
      ],
      saved: "Saved securely",
    },
    f2: {
      title: "Your profile page",
      body: "Update your name, photo and address, and change your own password whenever you like.",
      name: "Sari Rahma",
      addr: "12 Melati St, Bandung",
      button: "Change password",
      photo: "Change photo",
    },
    f3: {
      title: "Family accounts",
      body: "Add family members and choose which wallets each of them can view or manage.",
      rows: [
        ["Dad", "All wallets", "Owner"],
        ["Mom", "Mandiri, BCA", "Manage"],
        ["Dika", "Pocket money", "View only"],
      ],
      add: "Add member",
    },
    f4: {
      title: "Pockets inside wallets",
      body: "Split one wallet's balance into pockets for different needs and get a heads-up when one runs low or empty.",
      wallet: "Mandiri",
      pockets: [
        ["Food", "Rp65k left of Rp500k", 87],
        ["Transport", "Rp180k left of Rp250k", 28],
      ],
      chat: "coffee 25k #food",
      alert: "⚠️ Food pocket is down to Rp65k",
    },
    footTitle: "For existing users",
    steps: [
      "Run the database file (<b>schema.sql</b>) once more.",
      "Everything else is optional — your existing settings keep working.",
    ],
  },
};

const wnIcon = {
  plug: `<svg viewBox="0 0 24 24"><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/></svg>`,
  user: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
  users: `<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a7 7 0 0 1 4 6.5"/></svg>`,
  wallet: `<svg viewBox="0 0 24 24"><path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4 2 4"/><circle cx="16.5" cy="13.5" r="1.2"/></svg>`,
};

/** 1200×1500 portrait "what's new in v1.5" card (shareable in chats); `lang` is "id" | "en". */
export function whatsNewV15Html({ logo, font, lang }) {
  const s = WHATS_NEW_V15[lang];
  const feature = (ic, f, mock) => `<div class="wn">
      <div class="wn-head"><span class="ic">${ic}</span>${f.title}</div>
      <p class="wn-body">${f.body}</p>
      <div class="mock">${mock}</div>
    </div>`;
  const row = (l, r, last) =>
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;${last ? "" : `border-bottom:1.5px solid ${C.border}`}"><span style="font:500 20px/1.2 Figtree">${l}</span><span style="font:700 19px/1 Figtree;color:${C.primary};white-space:nowrap">${r}</span></div>`;

  const m1 = `${s.f1.rows.map(([l, r], i) => row(l, r, i === s.f1.rows.length - 1)).join("")}
    <div style="margin-top:10px"><span class="tag" style="background:${C.primarySoft};color:${C.primary};font-size:18px">🔒 ${s.f1.saved}</span></div>`;

  const m2 = `<div style="display:flex;align-items:center;gap:18px">
      <div style="width:76px;height:76px;border-radius:50%;background:${C.goldSoft};border:3px solid ${C.gold};display:grid;place-items:center;font:700 28px/1 'Bricolage Grotesque';color:${C.goldInk}">SR</div>
      <div><div style="font:700 24px/1.1 Figtree">${s.f2.name}</div><div style="font:500 19px/1.3 Figtree;color:${C.muted};margin-top:6px">${s.f2.addr}</div><span class="tag" style="background:${C.card};border:1.5px solid ${C.border};color:${C.primary};font-size:17px;margin-top:10px">📷 ${s.f2.photo}</span></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <div style="flex:1;height:44px;border-radius:10px;border:1.5px solid ${C.border};background:${C.card};padding:0 14px;display:flex;align-items:center;font:700 18px/1 Figtree;letter-spacing:3px;color:${C.muted}">••••••••</div>
      <span class="pill" style="font-size:19px;padding:13px 16px">${s.f2.button}</span>
    </div>`;

  const roleColor = [
    [C.primary, C.cream],
    [C.primarySoft, C.primary],
    [C.blueSoft, C.blue],
  ];
  const m3 = `${s.f3.rows
    .map(
      (
        [n, w, r],
        i,
      ) => `<div style="display:flex;align-items:center;gap:14px;padding:11px 0;border-bottom:1.5px solid ${C.border}">
      <div style="width:44px;height:44px;border-radius:50%;background:${C.card};display:grid;place-items:center;font:700 19px/1 Figtree;color:${C.primary}">${n[0]}</div>
      <div style="flex:1"><div style="font:700 20px/1.1 Figtree">${n}</div><div style="font:500 18px/1.2 Figtree;color:${C.muted};margin-top:3px">${w}</div></div>
      <span class="tag" style="background:${roleColor[i][0]};color:${roleColor[i][1]};font-size:17px">${r}</span></div>`,
    )
    .join("")}
    <div style="margin:12px 0 6px;height:44px;border-radius:10px;border:1.5px dashed ${C.primary};display:grid;place-items:center;font:700 19px/1 Figtree;color:${C.primary}">+ ${s.f3.add}</div>`;

  const m4 = `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:18px"><span style="font:700 20px/1 Figtree">${s.f4.wallet}</span><span class="mono" style="font:700 20px/1 'JetBrains Mono'">Rp1.200.000</span></div>
    ${s.f4.pockets
      .map(
        ([n, l, p], i) => `<div style="margin-top:${i ? 16 : 0}px">
        <div style="display:flex;justify-content:space-between;font:600 19px/1 Figtree;margin-bottom:8px"><span>${n}</span><span style="color:${p > 80 ? C.goldInk : C.muted}">${l}</span></div>
        <div class="bar" style="height:10px;background:${C.card}"><span style="width:${p}%;background:${p > 80 ? C.warning : C.income}"></span></div></div>`,
      )
      .join("")}
    <div style="display:flex;justify-content:flex-end;margin-top:14px"><div class="bubble" style="background:${C.primary};color:${C.cream};font-size:19px">${s.f4.chat}</div></div>
    <div class="bubble" style="background:${C.goldSoft};color:${C.goldInk};font:600 19px/1.25 Figtree;margin-top:8px;width:fit-content">${s.f4.alert}</div>`;

  return `<style>${baseCss(font)}
    .wn{background:${C.card};border:1.5px solid ${C.border};border-radius:24px;padding:28px 28px 26px;
      box-shadow:0 10px 30px -18px #1d3b2f40;display:flex;flex-direction:column}
    .wn-head{display:flex;align-items:center;gap:14px;font:700 26px/1.1 "Bricolage Grotesque";letter-spacing:-.4px}
    .wn .ic{width:44px;height:44px;border-radius:12px;flex:none}
    .wn .ic svg{width:24px;height:24px}
    .wn-body{font:400 22px/1.42 Figtree;color:${C.muted};margin-top:14px}
    .mock{margin-top:auto;padding-top:20px}
  </style>
  <div class="canvas" style="width:1200px;height:1500px;padding:56px 64px 0">
    <div style="display:flex;align-items:center;justify-content:space-between">
      ${brand(logo, 64)}
      <span class="pill" style="background:${C.gold};color:${C.ink};font-size:22px;font-weight:700">v1.5</span>
    </div>
    <div class="eyebrow" style="margin-top:30px;font-size:17px">${s.eyebrow}</div>
    <h1 class="display" style="font-weight:800;font-size:76px;line-height:1;letter-spacing:-2.5px;margin-top:14px">${s.title}</h1>
    <p style="font:400 25px/1.4 Figtree;color:${C.muted};margin-top:16px;width:900px">${s.subtitle}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:30px">
      ${feature(wnIcon.plug, s.f1, `<div style="background:${C.soft};border-radius:16px;padding:6px 18px 14px">${m1}</div>`)}
      ${feature(wnIcon.user, s.f2, `<div style="background:${C.soft};border-radius:16px;padding:18px">${m2}</div>`)}
      ${feature(wnIcon.users, s.f3, `<div style="background:${C.soft};border-radius:16px;padding:6px 18px">${m3}</div>`)}
      ${feature(wnIcon.wallet, s.f4, `<div style="background:${C.soft};border-radius:16px;padding:18px">${m4}</div>`)}
    </div>
    <div style="position:absolute;left:0;right:0;bottom:0;background:${C.ink};color:${C.cream};padding:28px 64px;display:flex;align-items:center;gap:32px">
      <div style="flex:1">
        <div style="font:700 17px/1 Figtree;letter-spacing:3px;text-transform:uppercase;color:${C.gold}">${s.footTitle}</div>
        ${s.steps
          .map(
            (t, i) =>
              `<div style="display:flex;gap:12px;align-items:baseline;margin-top:${i ? 8 : 14}px;font:400 23px/1.35 Figtree"><span style="font:700 20px/1 'JetBrains Mono';color:${C.gold}">${i + 1}</span><span>${t}</span></div>`,
          )
          .join("")}
      </div>
      <span class="pill" style="background:${C.cream};color:${C.ink};flex:none">dompetku.ilramdhan.dev</span>
    </div>
  </div>`;
}
