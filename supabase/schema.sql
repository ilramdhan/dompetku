-- Dompetku schema. Jalankan sekali di Supabase SQL Editor.
-- Semua akses data lewat server (service role). RLS aktif tanpa policy =
-- anon/authenticated tidak bisa membaca apa pun dari browser.

create extension if not exists pgcrypto;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'bank' check (type in ('bank','ewallet','cash','credit_card','investment','other')),
  currency text not null default 'IDR' check (currency in ('IDR','USD')),
  initial_balance numeric(18,2) not null default 0,
  color text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('income','expense')),
  color text,
  created_at timestamptz not null default now(),
  unique (name, kind)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('income','expense','transfer')),
  amount numeric(18,2) not null check (amount > 0),
  currency text not null default 'IDR' check (currency in ('IDR','USD')),
  amount_idr numeric(18,2) not null,
  account_id uuid references public.accounts(id) on delete set null,
  to_account_id uuid references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  description text,
  merchant text,
  occurred_at date not null default current_date,
  source text not null default 'web',
  items jsonb,
  notes text,
  raw jsonb,
  receipt_path text,
  created_at timestamptz not null default now()
);
-- Jika tabel transactions sudah dibuat sebelumnya, jalankan:
-- alter table public.transactions add column if not exists receipt_path text;
create index if not exists transactions_occurred_idx on public.transactions (occurred_at desc);
create index if not exists transactions_category_idx on public.transactions (category_id);
create index if not exists transactions_account_idx on public.transactions (account_id);

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text,
  kind text not null default 'paylater' check (kind in ('paylater','loan','credit_card','personal','other')),
  currency text not null default 'IDR' check (currency in ('IDR','USD')),
  total_amount numeric(18,2) not null,
  installment_amount numeric(18,2) not null,
  total_installments int not null check (total_installments > 0),
  start_date date not null,
  due_day int not null check (due_day between 1 and 31),
  interest_rate numeric(8,4),
  account_id uuid references public.accounts(id) on delete set null,
  notes text,
  status text not null default 'active' check (status in ('active','paid_off')),
  created_at timestamptz not null default now()
);

create table if not exists public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete cascade,
  installment_no int not null,
  amount numeric(18,2) not null,
  paid_at date not null default current_date,
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (debt_id, installment_no)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric(18,2) not null,
  currency text not null default 'IDR' check (currency in ('IDR','USD')),
  cycle text not null default 'monthly' check (cycle in ('monthly','yearly')),
  next_due date not null,
  account_id uuid references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null unique references public.categories(id) on delete cascade,
  amount numeric(18,2) not null,
  alert_percent int not null default 80,
  created_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_amount numeric(18,2) not null,
  saved_amount numeric(18,2) not null default 0,
  deadline date,
  color text,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity text,
  detail jsonb,
  created_at timestamptz not null default now()
);


create table if not exists public.fx_rates (
  rate_date date not null,
  base text not null,
  quote text not null,
  rate numeric(18,6) not null,
  primary key (rate_date, base, quote)
);

create or replace view public.account_balances with (security_invoker = true) as
select a.id, a.name, a.type, a.currency, a.color, a.archived, a.initial_balance,
  a.initial_balance + coalesce(sum(
    case
      when t.account_id = a.id and t.kind = 'income' then t.amount
      when t.account_id = a.id and t.kind in ('expense','transfer') then -t.amount
      when t.to_account_id = a.id and t.kind = 'transfer' then t.amount
      else 0 end), 0) as balance
from public.accounts a
left join public.transactions t on t.account_id = a.id or t.to_account_id = a.id
group by a.id;

-- Grants: hanya service_role (server). Browser tidak punya akses.
do $$
declare t text;
begin
  foreach t in array array['accounts','categories','transactions','debts','debt_payments','subscriptions','budgets','goals','fx_rates','activity_log'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
revoke all on public.account_balances from anon, authenticated;
grant select on public.account_balances to service_role;

insert into public.categories (name, kind, color) values
  ('Gaji','income','#2f7d5b'), ('Bonus','income','#5a9e6f'), ('Freelance','income','#3e8e8a'), ('Lainnya','income','#7a8b6a'),
  ('Makanan & Minuman','expense','#d0703c'), ('Transportasi','expense','#c99a2e'), ('Belanja','expense','#b85c5c'),
  ('Tagihan & Utilitas','expense','#5b7fa6'), ('Hiburan','expense','#8a6fb0'), ('Kesehatan','expense','#4f9a94'),
  ('Pendidikan','expense','#6a8f3a'), ('Langganan','expense','#a3683a'), ('Cicilan & Hutang','expense','#8c3f3f'), ('Lainnya','expense','#7d7d6f')
on conflict (name, kind) do nothing;

-- ===== v2: foto nota & impor CSV (aman dijalankan ulang) =====
alter table public.transactions add column if not exists receipt_path text;

-- Bucket privat untuk foto nota. Jika perintah ini ditolak, buat manual:
-- Dashboard Supabase → Storage → New bucket → nama "receipts", Public: OFF, batas 5 MB.
insert into storage.buckets (id, name, public, file_size_limit)
values ('receipts', 'receipts', false, 5242880)
on conflict (id) do nothing;
-- Tidak perlu policy: hanya server (service role) yang mengakses bucket ini;
-- browser melihat foto lewat signed URL berlaku 10 menit.

-- ===== v3: catatan aktivitas, tabungan emas, piutang (aman dijalankan ulang) =====
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_log_created_idx on public.activity_log (created_at desc);

create table if not exists public.gold_purchases (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'buy' check (kind in ('buy','sell')),
  occurred_at date not null default current_date,
  grams numeric(14,4) not null check (grams > 0),
  price_per_gram numeric(18,2) not null check (price_per_gram > 0),
  total numeric(18,2) not null,
  place text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.gold_prices (
  price_date date not null,
  source text not null check (source in ('world','antam')),
  buy numeric(18,2) not null,
  buyback numeric(18,2) not null,
  estimated boolean not null default false,
  fetched_at timestamptz not null default now(),
  primary key (price_date, source)
);

create table if not exists public.receivables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  borrower text,
  amount numeric(18,2) not null check (amount > 0),
  currency text not null default 'IDR' check (currency in ('IDR','USD')),
  lent_at date not null default current_date,
  due_date date,
  account_id uuid references public.accounts(id) on delete set null,
  transaction_id uuid references public.transactions(id) on delete set null,
  notes text,
  status text not null default 'active' check (status in ('active','paid')),
  created_at timestamptz not null default now()
);

create table if not exists public.receivable_payments (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null references public.receivables(id) on delete cascade,
  amount numeric(18,2) not null check (amount > 0),
  paid_at date not null default current_date,
  account_id uuid references public.accounts(id) on delete set null,
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists receivable_payments_rec_idx on public.receivable_payments (receivable_id);

do $$
declare t text;
begin
  foreach t in array array['activity_log','gold_purchases','gold_prices','receivables','receivable_payments'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

insert into public.categories (name, kind, color) values ('Piutang','expense','#9a7b3c'), ('Piutang','income','#9a7b3c')
on conflict (name, kind) do nothing;

-- ============ v4: biaya admin/transfer, biaya bulanan akun, pajak langganan (aman dijalankan ulang) ============
alter table public.accounts add column if not exists transfer_fees jsonb not null default '[]'::jsonb;
alter table public.accounts add column if not exists topup_fees jsonb not null default '[]'::jsonb;
alter table public.accounts add column if not exists monthly_fee numeric(18,2);
alter table public.accounts add column if not exists monthly_fee_day int check (monthly_fee_day between 1 and 31);
alter table public.subscriptions add column if not exists tax_percent numeric(6,2) check (tax_percent >= 0 and tax_percent <= 100);
insert into public.categories (name, kind, color) values ('Biaya Admin','expense','#8a6d5a')
on conflict (name, kind) do nothing;
create index if not exists transactions_notes_auto_idx on public.transactions (notes) where notes like '[auto:%';

-- ============ v5: metadata emas & indeks query utama (aman dijalankan ulang) ============
alter table public.gold_purchases add column if not exists gold_type text;
alter table public.gold_purchases add column if not exists product_number text;
create index if not exists gold_purchases_occurred_idx on public.gold_purchases (occurred_at desc);
create index if not exists subscriptions_active_next_due_idx on public.subscriptions (active, next_due);
create index if not exists transactions_to_account_idx on public.transactions (to_account_id);
create index if not exists transactions_occurred_kind_idx on public.transactions (occurred_at desc, kind);
create index if not exists receivables_status_idx on public.receivables (status);

-- ============ v6: emas tertaut ke akun & transaksi kategori "Emas" (aman dijalankan ulang) ============
alter table public.gold_purchases add column if not exists account_id uuid references public.accounts(id) on delete set null;
alter table public.gold_purchases add column if not exists transaction_id uuid references public.transactions(id) on delete set null;
insert into public.categories (name, kind, color) values ('Emas','expense','#c9a227'), ('Emas','income','#c9a227')
on conflict (name, kind) do nothing;

-- ============ v7: bot Telegram — idempotensi & pratinjau sebelum simpan (aman dijalankan ulang) ============
-- external_id: kunci idempotensi (mis. "draft:<uuid>") agar retry webhook / klik ganda tidak mencatat dua kali.
alter table public.transactions add column if not exists external_id text;
create unique index if not exists transactions_external_id_uidx on public.transactions (external_id) where external_id is not null;
create index if not exists transactions_source_created_idx on public.transactions (source, created_at desc);

-- Pratinjau transaksi dari bot (chat / foto nota) yang menunggu tombol ✅/❌.
create table if not exists public.bot_drafts (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,           -- "tg:<chat_id>:<update_id>"
  chat_id text not null,
  source text not null default 'telegram' check (source in ('telegram','whatsapp','ocr')),
  payload jsonb not null,
  receipt_path text,
  status text not null default 'pending' check (status in ('pending','saved','cancelled','undone')),
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bot_drafts_created_idx on public.bot_drafts (created_at);
create index if not exists bot_drafts_tx_idx on public.bot_drafts (transaction_id);
revoke all on public.bot_drafts from anon, authenticated;
grant all on public.bot_drafts to service_role;
alter table public.bot_drafts enable row level security;

-- ============ v8: target tabungan tertaut ke akun tabungan (aman dijalankan ulang) ============
-- Setor/tarik dana target dicatat sebagai transfer antar akun (bukan pengeluaran).
alter table public.goals add column if not exists account_id uuid references public.accounts(id) on delete set null;

-- ============ v9: agregasi laporan di Postgres (aman dijalankan ulang) ============
-- Fungsi ringkasan agar dashboard/laporan tidak perlu mengunduh semua transaksi. Opsional:
-- tanpa bagian ini aplikasi otomatis memakai perhitungan lama (hasil identik).
-- Bulan = to_char(occurred_at,'YYYY-MM') (occurred_at bertipe date, tanpa zona waktu).
create or replace function public.dk_month_totals(p_start date, p_end date)
returns table (month text, kind text, total numeric)
language sql stable security invoker set search_path = public as $$
  select to_char(t.occurred_at, 'YYYY-MM') as month, t.kind, sum(t.amount_idr) as total
  from public.transactions t
  where t.occurred_at >= p_start and t.occurred_at < p_end and t.kind <> 'transfer'
  group by 1, 2;
$$;

create or replace function public.dk_category_totals(p_start date, p_end date, p_kind text)
returns table (category_id uuid, name text, color text, total numeric)
language sql stable security invoker set search_path = public as $$
  select t.category_id, c.name, c.color, sum(t.amount_idr) as total
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  where t.occurred_at >= p_start and t.occurred_at < p_end and t.kind = p_kind
  group by t.category_id, c.name, c.color;
$$;

create or replace function public.dk_month_category_totals(p_start date, p_end date)
returns table (month text, category_id uuid, name text, color text, total numeric)
language sql stable security invoker set search_path = public as $$
  select to_char(t.occurred_at, 'YYYY-MM') as month, t.category_id, c.name, c.color,
    sum(t.amount_idr) as total
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  where t.occurred_at >= p_start and t.occurred_at < p_end and t.kind = 'expense'
  group by 1, t.category_id, c.name, c.color;
$$;

create or replace function public.dk_monthly_net(p_end date)
returns table (month text, net numeric)
language sql stable security invoker set search_path = public as $$
  select to_char(t.occurred_at, 'YYYY-MM') as month,
    sum(case when t.kind = 'income' then t.amount_idr else -t.amount_idr end) as net
  from public.transactions t
  where t.occurred_at < p_end and t.kind <> 'transfer'
  group by 1;
$$;

-- Hanya server (service_role) yang boleh memanggil.
revoke all on function public.dk_month_totals(date, date) from public, anon, authenticated;
revoke all on function public.dk_category_totals(date, date, text) from public, anon, authenticated;
revoke all on function public.dk_month_category_totals(date, date) from public, anon, authenticated;
revoke all on function public.dk_monthly_net(date) from public, anon, authenticated;
grant execute on function public.dk_month_totals(date, date) to service_role;
grant execute on function public.dk_category_totals(date, date, text) to service_role;
grant execute on function public.dk_month_category_totals(date, date) to service_role;
grant execute on function public.dk_monthly_net(date) to service_role;
-- Muat ulang cache skema PostgREST agar fungsi baru langsung terlihat.
notify pgrst, 'reload schema';

-- ============ v10: transaksi berulang — gaji, sewa, transfer rutin (aman dijalankan ulang) ============
-- Item auto_post dicatat otomatis saat dashboard/pengingat dibuka (idempoten lewat penanda di notes
-- "[auto:recurring:<id>:<tanggal>]" dan external_id "recurring:<id>:<tanggal>").
create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('income','expense','transfer')),
  amount numeric(18,2) not null check (amount > 0),
  currency text not null default 'IDR' check (currency in ('IDR','USD')),
  account_id uuid references public.accounts(id) on delete set null,
  to_account_id uuid references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  description text,
  merchant text,
  cycle text not null default 'monthly' check (cycle in ('weekly','monthly','yearly')),
  "interval" int not null default 1 check ("interval" >= 1),
  day_of_month int check (day_of_month between 1 and 31),
  start_date date not null default current_date,
  next_due date not null,
  end_date date,
  auto_post boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists recurring_transactions_due_idx on public.recurring_transactions (active, next_due);
revoke all on public.recurring_transactions from anon, authenticated;
grant all on public.recurring_transactions to service_role;
alter table public.recurring_transactions enable row level security;
notify pgrst, 'reload schema';

-- ============ v11: budget rollover & peringatan instan 80%/100% (aman dijalankan ulang) ============
-- rollover: sisa (atau kelebihan) budget bulan lalu dibawa ke bulan ini (maks. 12 bulan ke belakang).
alter table public.budgets add column if not exists rollover boolean not null default false;
-- Catatan ambang yang sudah diperingatkan agar tiap level hanya sekali per bulan.
create table if not exists public.budget_alerts (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets(id) on delete cascade,
  month text not null,
  level int not null check (level in (80, 100)),
  created_at timestamptz not null default now(),
  unique (budget_id, month, level)
);
revoke all on public.budget_alerts from anon, authenticated;
grant all on public.budget_alerts to service_role;
alter table public.budget_alerts enable row level security;
notify pgrst, 'reload schema';

-- ============ v12: split transaksi, banyak foto nota & cari item nota (aman dijalankan ulang) ============
-- Split: satu nota dibagi ke beberapa kategori = beberapa transaksi pengeluaran biasa dengan
-- split_group yang sama (budget/laporan/agregasi tetap benar tanpa perubahan).
alter table public.transactions add column if not exists split_group uuid;
create index if not exists transactions_split_group_idx on public.transactions (split_group)
  where split_group is not null;
-- Banyak foto per transaksi (receipt_path tetap = foto pertama untuk kompatibilitas).
alter table public.transactions add column if not exists receipt_paths text[];
-- Teks item nota (huruf kecil) agar pencarian transaksi juga mencocokkan nama item.
alter table public.transactions add column if not exists items_search text
  generated always as (lower(coalesce(items::text, ''))) stored;
notify pgrst, 'reload schema';

-- ============ v13: laporan per akun & rekonsiliasi mutasi bank (aman dijalankan ulang) ============
-- Opsional: tanpa bagian ini halaman akun memakai perhitungan JS (hasil identik) dan
-- kartu "terakhir direkonsiliasi" disembunyikan.
-- Logika sama dengan view account_balances: masuk = pemasukan di akun + transfer ke akun;
-- keluar = pengeluaran + transfer dari akun (memakai kolom amount, mata uang akun).
create or replace function public.dk_account_monthly(p_account uuid, p_end date)
returns table (month text, inflow numeric, outflow numeric)
language sql stable security invoker set search_path = public as $$
  select to_char(t.occurred_at, 'YYYY-MM') as month,
    sum(case
      when t.account_id = p_account and t.kind = 'income' then t.amount
      when t.account_id = p_account then 0
      when t.to_account_id = p_account and t.kind = 'transfer' then t.amount
      else 0 end) as inflow,
    sum(case
      when t.account_id = p_account and t.kind in ('expense','transfer') then t.amount
      else 0 end) as outflow
  from public.transactions t
  where (t.account_id = p_account or t.to_account_id = p_account) and t.occurred_at < p_end
  group by 1;
$$;
revoke all on function public.dk_account_monthly(uuid, date) from public, anon, authenticated;
grant execute on function public.dk_account_monthly(uuid, date) to service_role;

create table if not exists public.account_reconciliations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  as_of date not null,
  statement_balance numeric(18,2) not null,
  app_balance numeric(18,2) not null,
  created_at timestamptz not null default now()
);
create index if not exists account_reconciliations_account_idx
  on public.account_reconciliations (account_id, as_of desc, created_at desc);
revoke all on public.account_reconciliations from anon, authenticated;
grant all on public.account_reconciliations to service_role;
alter table public.account_reconciliations enable row level security;
notify pgrst, 'reload schema';

-- ============ v14: pengaturan aplikasi — nama, logo, zona waktu, default bot (aman dijalankan ulang) ============
-- Opsional: tanpa bagian ini aplikasi memakai env (APP_TIMEZONE, BOT_DEFAULT_ACCOUNT) dan default bawaan.
-- Satu baris saja (id = 1). Logo disimpan sebagai data URL PNG/JPEG/WebP kecil (≤ 200 KB) agar
-- favicon & halaman login bisa memuatnya lewat /api/public/app-icon tanpa signed URL Storage.
create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  app_name text,
  tagline text,
  logo_data text check (logo_data is null or length(logo_data) <= 300000),
  timezone text,
  base_currency text check (base_currency is null or base_currency in ('IDR','USD')),
  landing_enabled boolean not null default true,
  landing_tagline text,
  github_url text,
  bot_default_account_id uuid references public.accounts(id) on delete set null,
  reminder_days int check (reminder_days is null or reminder_days between 1 and 365),
  updated_at timestamptz not null default now()
);
revoke all on public.app_settings from anon, authenticated;
grant all on public.app_settings to service_role;
alter table public.app_settings enable row level security;
notify pgrst, 'reload schema';

-- ============ v15: log pemakaian AI & kuota AI harian bot per chat (aman dijalankan ulang) ============
-- Opsional: tanpa bagian ini kuota bot dihitung kira-kira dari draft AI/foto di bot_drafts.
-- Satu baris per panggilan AI (OCR web/bot, parsing chat). day = tanggal lokal aplikasi.
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  day date not null,
  source text not null check (source in ('bot','web')),
  chat_id text,
  kind text not null check (kind in ('text','vision')),
  model text not null,
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  ok boolean not null default true
);
create index if not exists ai_usage_day_chat_idx on public.ai_usage (day, chat_id);
revoke all on public.ai_usage from anon, authenticated;
grant all on public.ai_usage to service_role;
alter table public.ai_usage enable row level security;
notify pgrst, 'reload schema';
