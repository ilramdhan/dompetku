/**
 * Supabase `Database` types for the public schema, in the format produced by
 * `supabase gen types typescript` (Tables: Row/Insert/Update/Relationships, Views, Functions).
 *
 * Hand-written from supabase/schema.sql (base + v2–v9). Columns added by an optional schema
 * section (v2+) are optional in `Row` because the user's database may not have them yet; the
 * server code drops & retries them when PostgREST rejects them.
 *
 * Regenerate from a live project with `npm run gen:types` (needs SUPABASE_PROJECT_ID and a
 * logged-in Supabase CLI). Generated output marks every column as present; that is fine.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Currency = "IDR" | "USD";

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      accounts: {
        Row: {
          id: string;
          name: string;
          type: "bank" | "ewallet" | "cash" | "credit_card" | "investment" | "other";
          currency: Currency;
          initial_balance: number;
          color: string | null;
          archived: boolean;
          created_at: string;
          /** v4 */
          transfer_fees?: Json;
          /** v4 */
          topup_fees?: Json;
          /** v4 */
          monthly_fee?: number | null;
          /** v4 */
          monthly_fee_day?: number | null;
        };
        Insert: {
          id?: string;
          name: string;
          type?: "bank" | "ewallet" | "cash" | "credit_card" | "investment" | "other";
          currency?: Currency;
          initial_balance?: number;
          color?: string | null;
          archived?: boolean;
          created_at?: string;
          transfer_fees?: Json;
          topup_fees?: Json;
          monthly_fee?: number | null;
          monthly_fee_day?: number | null;
        };
        Update: {
          id?: string;
          name?: string;
          type?: "bank" | "ewallet" | "cash" | "credit_card" | "investment" | "other";
          currency?: Currency;
          initial_balance?: number;
          color?: string | null;
          archived?: boolean;
          created_at?: string;
          transfer_fees?: Json;
          topup_fees?: Json;
          monthly_fee?: number | null;
          monthly_fee_day?: number | null;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          name: string;
          kind: "income" | "expense";
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          kind: "income" | "expense";
          color?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          kind?: "income" | "expense";
          color?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          id: string;
          kind: "income" | "expense" | "transfer";
          amount: number;
          currency: Currency;
          amount_idr: number;
          account_id: string | null;
          to_account_id: string | null;
          category_id: string | null;
          description: string | null;
          merchant: string | null;
          occurred_at: string;
          source: string;
          items: Json | null;
          notes: string | null;
          raw: Json | null;
          created_at: string;
          /** v2 */
          receipt_path?: string | null;
          /** v7 */
          external_id?: string | null;
          /** v12 */
          split_group?: string | null;
          /** v12 */
          receipt_paths?: string[] | null;
          /** v12 (generated) */
          items_search?: string | null;
        };
        Insert: {
          id?: string;
          kind: "income" | "expense" | "transfer";
          amount: number;
          currency?: Currency;
          amount_idr: number;
          account_id?: string | null;
          to_account_id?: string | null;
          category_id?: string | null;
          description?: string | null;
          merchant?: string | null;
          occurred_at?: string;
          source?: string;
          items?: Json | null;
          notes?: string | null;
          raw?: Json | null;
          receipt_path?: string | null;
          created_at?: string;
          external_id?: string | null;
          split_group?: string | null;
          receipt_paths?: string[] | null;
        };
        Update: {
          id?: string;
          kind?: "income" | "expense" | "transfer";
          amount?: number;
          currency?: Currency;
          amount_idr?: number;
          account_id?: string | null;
          to_account_id?: string | null;
          category_id?: string | null;
          description?: string | null;
          merchant?: string | null;
          occurred_at?: string;
          source?: string;
          items?: Json | null;
          notes?: string | null;
          raw?: Json | null;
          receipt_path?: string | null;
          created_at?: string;
          external_id?: string | null;
          split_group?: string | null;
          receipt_paths?: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "account_balances";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_to_account_id_fkey";
            columns: ["to_account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_to_account_id_fkey";
            columns: ["to_account_id"];
            isOneToOne: false;
            referencedRelation: "account_balances";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      debts: {
        Row: {
          id: string;
          name: string;
          provider: string | null;
          kind: "paylater" | "loan" | "credit_card" | "personal" | "other";
          currency: Currency;
          total_amount: number;
          installment_amount: number;
          total_installments: number;
          start_date: string;
          due_day: number;
          interest_rate: number | null;
          account_id: string | null;
          notes: string | null;
          status: "active" | "paid_off";
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          provider?: string | null;
          kind?: "paylater" | "loan" | "credit_card" | "personal" | "other";
          currency?: Currency;
          total_amount: number;
          installment_amount: number;
          total_installments: number;
          start_date: string;
          due_day: number;
          interest_rate?: number | null;
          account_id?: string | null;
          notes?: string | null;
          status?: "active" | "paid_off";
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          provider?: string | null;
          kind?: "paylater" | "loan" | "credit_card" | "personal" | "other";
          currency?: Currency;
          total_amount?: number;
          installment_amount?: number;
          total_installments?: number;
          start_date?: string;
          due_day?: number;
          interest_rate?: number | null;
          account_id?: string | null;
          notes?: string | null;
          status?: "active" | "paid_off";
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "debts_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      debt_payments: {
        Row: {
          id: string;
          debt_id: string;
          installment_no: number;
          amount: number;
          paid_at: string;
          transaction_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          debt_id: string;
          installment_no: number;
          amount: number;
          paid_at?: string;
          transaction_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          debt_id?: string;
          installment_no?: number;
          amount?: number;
          paid_at?: string;
          transaction_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "debt_payments_debt_id_fkey";
            columns: ["debt_id"];
            isOneToOne: false;
            referencedRelation: "debts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "debt_payments_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          id: string;
          name: string;
          amount: number;
          currency: Currency;
          cycle: "monthly" | "yearly";
          next_due: string;
          account_id: string | null;
          category_id: string | null;
          active: boolean;
          notes: string | null;
          created_at: string;
          /** v4 */
          tax_percent?: number | null;
        };
        Insert: {
          id?: string;
          name: string;
          amount: number;
          currency?: Currency;
          cycle?: "monthly" | "yearly";
          next_due: string;
          account_id?: string | null;
          category_id?: string | null;
          active?: boolean;
          notes?: string | null;
          created_at?: string;
          tax_percent?: number | null;
        };
        Update: {
          id?: string;
          name?: string;
          amount?: number;
          currency?: Currency;
          cycle?: "monthly" | "yearly";
          next_due?: string;
          account_id?: string | null;
          category_id?: string | null;
          active?: boolean;
          notes?: string | null;
          created_at?: string;
          tax_percent?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      budgets: {
        Row: {
          id: string;
          category_id: string;
          amount: number;
          alert_percent: number;
          /** v11 */
          rollover?: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          category_id: string;
          amount: number;
          alert_percent?: number;
          rollover?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          category_id?: string;
          amount?: number;
          alert_percent?: number;
          rollover?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: true;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      goals: {
        Row: {
          id: string;
          name: string;
          target_amount: number;
          saved_amount: number;
          deadline: string | null;
          color: string | null;
          created_at: string;
          /** v8 */
          account_id?: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          target_amount: number;
          saved_amount?: number;
          deadline?: string | null;
          color?: string | null;
          created_at?: string;
          account_id?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          target_amount?: number;
          saved_amount?: number;
          deadline?: string | null;
          color?: string | null;
          created_at?: string;
          account_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "goals_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      activity_log: {
        Row: {
          id: string;
          action: string;
          entity: string | null;
          detail: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          action: string;
          entity?: string | null;
          detail?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          action?: string;
          entity?: string | null;
          detail?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      fx_rates: {
        Row: {
          rate_date: string;
          base: string;
          quote: string;
          rate: number;
        };
        Insert: {
          rate_date: string;
          base: string;
          quote: string;
          rate: number;
        };
        Update: {
          rate_date?: string;
          base?: string;
          quote?: string;
          rate?: number;
        };
        Relationships: [];
      };
      gold_purchases: {
        Row: {
          id: string;
          kind: "buy" | "sell";
          occurred_at: string;
          grams: number;
          price_per_gram: number;
          total: number;
          place: string | null;
          notes: string | null;
          created_at: string;
          /** v5 */
          gold_type?: string | null;
          /** v5 */
          product_number?: string | null;
          /** v6 */
          account_id?: string | null;
          /** v6 */
          transaction_id?: string | null;
        };
        Insert: {
          id?: string;
          kind?: "buy" | "sell";
          occurred_at?: string;
          grams: number;
          price_per_gram: number;
          total: number;
          place?: string | null;
          notes?: string | null;
          created_at?: string;
          gold_type?: string | null;
          product_number?: string | null;
          account_id?: string | null;
          transaction_id?: string | null;
        };
        Update: {
          id?: string;
          kind?: "buy" | "sell";
          occurred_at?: string;
          grams?: number;
          price_per_gram?: number;
          total?: number;
          place?: string | null;
          notes?: string | null;
          created_at?: string;
          gold_type?: string | null;
          product_number?: string | null;
          account_id?: string | null;
          transaction_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "gold_purchases_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gold_purchases_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      gold_prices: {
        Row: {
          price_date: string;
          source: "world" | "antam";
          buy: number;
          buyback: number;
          estimated: boolean;
          fetched_at: string;
        };
        Insert: {
          price_date: string;
          source: "world" | "antam";
          buy: number;
          buyback: number;
          estimated?: boolean;
          fetched_at?: string;
        };
        Update: {
          price_date?: string;
          source?: "world" | "antam";
          buy?: number;
          buyback?: number;
          estimated?: boolean;
          fetched_at?: string;
        };
        Relationships: [];
      };
      receivables: {
        Row: {
          id: string;
          name: string;
          borrower: string | null;
          amount: number;
          currency: Currency;
          lent_at: string;
          due_date: string | null;
          account_id: string | null;
          transaction_id: string | null;
          notes: string | null;
          status: "active" | "paid";
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          borrower?: string | null;
          amount: number;
          currency?: Currency;
          lent_at?: string;
          due_date?: string | null;
          account_id?: string | null;
          transaction_id?: string | null;
          notes?: string | null;
          status?: "active" | "paid";
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          borrower?: string | null;
          amount?: number;
          currency?: Currency;
          lent_at?: string;
          due_date?: string | null;
          account_id?: string | null;
          transaction_id?: string | null;
          notes?: string | null;
          status?: "active" | "paid";
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "receivables_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "receivables_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      receivable_payments: {
        Row: {
          id: string;
          receivable_id: string;
          amount: number;
          paid_at: string;
          account_id: string | null;
          transaction_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          receivable_id: string;
          amount: number;
          paid_at?: string;
          account_id?: string | null;
          transaction_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          receivable_id?: string;
          amount?: number;
          paid_at?: string;
          account_id?: string | null;
          transaction_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "receivable_payments_receivable_id_fkey";
            columns: ["receivable_id"];
            isOneToOne: false;
            referencedRelation: "receivables";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "receivable_payments_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "receivable_payments_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      bot_drafts: {
        Row: {
          id: string;
          external_id: string;
          chat_id: string;
          source: "telegram" | "whatsapp" | "ocr";
          payload: Json;
          receipt_path: string | null;
          status: "pending" | "saved" | "cancelled" | "undone";
          transaction_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          external_id: string;
          chat_id: string;
          source?: "telegram" | "whatsapp" | "ocr";
          payload: Json;
          receipt_path?: string | null;
          status?: "pending" | "saved" | "cancelled" | "undone";
          transaction_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          external_id?: string;
          chat_id?: string;
          source?: "telegram" | "whatsapp" | "ocr";
          payload?: Json;
          receipt_path?: string | null;
          status?: "pending" | "saved" | "cancelled" | "undone";
          transaction_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bot_drafts_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      /** v10 (optional table): recurring income/expense/transfer. */
      recurring_transactions: {
        Row: {
          id: string;
          name: string;
          kind: "income" | "expense" | "transfer";
          amount: number;
          currency: Currency;
          account_id: string | null;
          to_account_id: string | null;
          category_id: string | null;
          description: string | null;
          merchant: string | null;
          cycle: "weekly" | "monthly" | "yearly";
          interval: number;
          day_of_month: number | null;
          start_date: string;
          next_due: string;
          end_date: string | null;
          auto_post: boolean;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          kind: "income" | "expense" | "transfer";
          amount: number;
          currency?: Currency;
          account_id?: string | null;
          to_account_id?: string | null;
          category_id?: string | null;
          description?: string | null;
          merchant?: string | null;
          cycle?: "weekly" | "monthly" | "yearly";
          interval?: number;
          day_of_month?: number | null;
          start_date: string;
          next_due: string;
          end_date?: string | null;
          auto_post?: boolean;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          kind?: "income" | "expense" | "transfer";
          amount?: number;
          currency?: Currency;
          account_id?: string | null;
          to_account_id?: string | null;
          category_id?: string | null;
          description?: string | null;
          merchant?: string | null;
          cycle?: "weekly" | "monthly" | "yearly";
          interval?: number;
          day_of_month?: number | null;
          start_date?: string;
          next_due?: string;
          end_date?: string | null;
          auto_post?: boolean;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_transactions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_transactions_to_account_id_fkey";
            columns: ["to_account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_transactions_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      /** v15 (optional table): one row per AI call (web/bot OCR and chat parsing). */
      ai_usage: {
        Row: {
          id: string;
          created_at: string;
          day: string;
          source: string;
          chat_id: string | null;
          kind: string;
          model: string;
          prompt_tokens: number | null;
          completion_tokens: number | null;
          total_tokens: number | null;
          ok: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          day: string;
          source: string;
          chat_id?: string | null;
          kind: string;
          model: string;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          total_tokens?: number | null;
          ok?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          day?: string;
          source?: string;
          chat_id?: string | null;
          kind?: string;
          model?: string;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          total_tokens?: number | null;
          ok?: boolean;
        };
        Relationships: [];
      };
      /** v11: threshold alerts already sent (one per budget, month and level). */
      budget_alerts: {
        Row: { id: string; budget_id: string; month: string; level: number; created_at: string };
        Insert: {
          id?: string;
          budget_id: string;
          month: string;
          level: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          budget_id?: string;
          month?: string;
          level?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "budget_alerts_budget_id_fkey";
            columns: ["budget_id"];
            isOneToOne: false;
            referencedRelation: "budgets";
            referencedColumns: ["id"];
          },
        ];
      };
      /** v13 (optional table): bank statement reconciliation checkpoints. */
      account_reconciliations: {
        Row: {
          id: string;
          account_id: string;
          as_of: string;
          statement_balance: number;
          app_balance: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          as_of: string;
          statement_balance: number;
          app_balance: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          as_of?: string;
          statement_balance?: number;
          app_balance?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "account_reconciliations_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      /** v14 (optional table): single-row app settings (id = 1) set from the Settings page. */
      app_settings: {
        Row: {
          id: number;
          app_name: string | null;
          tagline: string | null;
          logo_data: string | null;
          timezone: string | null;
          base_currency: Currency | null;
          landing_enabled: boolean;
          landing_tagline: string | null;
          github_url: string | null;
          bot_default_account_id: string | null;
          reminder_days: number | null;
          updated_at: string;
        };
        Insert: {
          id?: number;
          app_name?: string | null;
          tagline?: string | null;
          logo_data?: string | null;
          timezone?: string | null;
          base_currency?: Currency | null;
          landing_enabled?: boolean;
          landing_tagline?: string | null;
          github_url?: string | null;
          bot_default_account_id?: string | null;
          reminder_days?: number | null;
          updated_at?: string;
        };
        Update: {
          id?: number;
          app_name?: string | null;
          tagline?: string | null;
          logo_data?: string | null;
          timezone?: string | null;
          base_currency?: Currency | null;
          landing_enabled?: boolean;
          landing_tagline?: string | null;
          github_url?: string | null;
          bot_default_account_id?: string | null;
          reminder_days?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "app_settings_bot_default_account_id_fkey";
            columns: ["bot_default_account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      account_balances: {
        Row: {
          id: string;
          name: string;
          type: "bank" | "ewallet" | "cash" | "credit_card" | "investment" | "other";
          currency: Currency;
          color: string | null;
          archived: boolean;
          initial_balance: number;
          balance: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      /** v9: totals (IDR) per month and kind in [p_start, p_end), transfers excluded. */
      dk_month_totals: {
        Args: { p_start: string; p_end: string };
        Returns: { month: string; kind: string; total: number }[];
      };
      /** v9: totals (IDR) per category of one kind in [p_start, p_end); null id = uncategorised. */
      dk_category_totals: {
        Args: { p_start: string; p_end: string; p_kind: string };
        Returns: {
          category_id: string | null;
          name: string | null;
          color: string | null;
          total: number;
        }[];
      };
      /** v9: expense totals (IDR) per month and category in [p_start, p_end). */
      dk_month_category_totals: {
        Args: { p_start: string; p_end: string };
        Returns: {
          month: string;
          category_id: string | null;
          name: string | null;
          color: string | null;
          total: number;
        }[];
      };
      /** v9: net (income − expense, IDR) per month for every month before p_end. */
      dk_monthly_net: {
        Args: { p_end: string };
        Returns: { month: string; net: number }[];
      };
      /** v13: per-month inflow/outflow (account currency) of one account before p_end. */
      dk_account_monthly: {
        Args: { p_account: string; p_end: string };
        Returns: { month: string; inflow: number; outflow: number }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];

/** Row type of a table or view, e.g. `Tables<"transactions">`. */
export type Tables<T extends keyof PublicSchema["Tables"] | keyof PublicSchema["Views"]> =
  T extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][T]["Row"]
    : T extends keyof PublicSchema["Views"]
      ? PublicSchema["Views"][T]["Row"]
      : never;
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type DbFunctions = PublicSchema["Functions"];
