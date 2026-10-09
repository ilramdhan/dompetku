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
