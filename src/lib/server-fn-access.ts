/**
 * Explicit access class of EVERY `createServerFn` (v18 RBAC). `src/test/server-fn-access.test.ts`
 * parses all `src/lib/*.functions.ts` files and fails when a server fn is missing here, is listed
 * here but gone, or uses a middleware that does not match its class:
 *
 * - `public`  — no middleware (login page, landing, version check). Must not return private data.
 * - `session` — `requireSession`: any signed-in user, even one who still has to change a
 *               temporary password (own profile / password only).
 * - `member`  — `requireAuth`: owner and members. The handler MUST scope by `accountScope(context)`
 *               or check wallet permissions (rbac.server.ts) — never return unscoped data.
 * - `admin`   — `requireAdmin`: owner only. The default for anything new.
 */
export type FnAccess = "public" | "session" | "member" | "admin";

export const SERVER_FN_ACCESS: Record<string, Record<string, FnAccess>> = {
  "account-report.functions.ts": {
    getAccountReport: "member",
    getAccountBalanceAt: "member",
    getReconcileTransactions: "member",
    saveAccountReconciliation: "admin",
  },
  "app-settings.functions.ts": {
    getPublicBranding: "public",
    getAppSettingsFull: "admin",
    saveAppSettingsFn: "admin",
  },
  "auth.functions.ts": {
    getSession: "public",
    login: "public",
    logout: "public",
    getTwoFactorStatus: "admin",
    generateTwoFactorSecret: "admin",
  },
  "backup.functions.ts": { restoreBackup: "admin" },
  "demo.functions.ts": { getDemoInfo: "public" },
  "finance.functions.ts": {
    listRows: "member",
    saveTransaction: "member",
    listTransactions: "member",
    getTxCount: "member",
    getDashboard: "member",
    getBalances: "member",
    getFxRate: "member",
    exportTransactionsCsv: "member",
    uploadReceiptImage: "member",
    getReceiptUrl: "member",
    getCategoryTrend: "member",
    getYearlySummary: "member",
    getNetWorth: "member",
    saveRow: "admin",
    deleteRow: "admin",
    getReminders: "admin",
    getDebts: "admin",
    getBudgets: "admin",
    payDebt: "admin",
    paySubscription: "admin",
    addGoalFunds: "admin",
    scanReceipt: "admin",
    getYearly: "admin",
    importTransactionsCsv: "admin",
    importCsvTransactions: "admin",
    exportBackupJson: "admin",
    getActivity: "admin",
    getGold: "admin",
    getReceivables: "admin",
    saveReceivableFn: "admin",
    payReceivableFn: "admin",
    receivableActionFn: "admin",
    getAssets: "admin",
  },
  "integrations.functions.ts": {
    getIntegrationSettings: "admin",
    saveIntegrationFn: "admin",
    removeIntegrationFn: "admin",
    testAiConnection: "admin",
    telegramStatus: "admin",
    setTelegramWebhook: "admin",
    deleteTelegramWebhook: "admin",
  },
  "profile.functions.ts": {
    getProfile: "session",
    updateProfile: "session",
    changePassword: "session",
  },
  "recurring.functions.ts": {
    getRecurring: "admin",
    postRecurring: "admin",
    toggleRecurring: "admin",
  },
  "split.functions.ts": { saveSplitTransaction: "member", deleteTransaction: "member" },
  "users.functions.ts": {
    listUsersFn: "admin",
    createMemberFn: "admin",
    updateMemberFn: "admin",
    resetMemberPasswordFn: "admin",
    deleteMemberFn: "admin",
    setMemberPermissionsFn: "admin",
  },
  "version.functions.ts": { getLatestRelease: "public" },
};

export const MIDDLEWARE_FOR: Record<FnAccess, string | null> = {
  public: null,
  session: "requireSession",
  member: "requireAuth",
  admin: "requireAdmin",
};
