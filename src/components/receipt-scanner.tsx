import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ScanLine } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { scanReceipt, uploadReceiptImage } from "@/lib/finance.functions";
import { errMsg, rowsQuery } from "@/lib/queries";
import { todayStr } from "@/lib/dates";
import { DemoGate } from "@/components/demo-gate";
import { useI18n } from "@/lib/i18n";
import type { Category } from "@/lib/schemas";
import type { TxDraft } from "./transaction-dialog";

export async function resize(file: File, max = 1600): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function ReceiptScanner({
  onDraft,
  variant = "outline",
}: {
  onDraft: (d: TxDraft) => void;
  variant?: "outline" | "default" | "secondary";
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const scan = useServerFn(scanReceipt);
  const upload = useServerFn(uploadReceiptImage);
  const categories = (useQuery(rowsQuery("categories")).data ?? []) as Category[];

  async function onFile(file: File) {
    setBusy(true);
    const tid = toast.loading(t("Membaca nota…"));

    try {
      const image = await resize(file);
      const [d, up] = await Promise.all([
        scan({ data: { image } }),
        upload({ data: { image } }).catch(() => null),
      ]);
      const cat = d.category
        ? categories.find(
            (c) =>
              c.kind === d.kind &&
              c.name.toLowerCase() ===
                d.category!.toLowerCase().replace(/\s*\((income|expense)\)$/, ""),
          )
        : undefined;
      onDraft({
        kind: d.kind,
        amount: d.amount || "",
        currency: d.currency,
        occurred_at: d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : todayStr(),
        merchant: d.merchant,
        description: d.description ?? d.merchant,
        category_id: cat?.id ?? null,
        items: d.items.length ? d.items : null,
        source: "ocr",
        receipt_path: up?.path ?? null,
      });
      toast.success(t("Nota terbaca — periksa lalu simpan"), { id: tid });
    } catch (e) {
      toast.error(t("Gagal membaca nota"), { id: tid, description: errMsg(e) });
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      <DemoGate
        fallback={
          <Button variant={variant} disabled>
            <ScanLine className="size-4" /> {t("Scan nota")}
          </Button>
        }
      >
        <Button variant={variant} disabled={busy} onClick={() => ref.current?.click()}>
          <ScanLine className="size-4" /> {busy ? t("Membaca…") : t("Scan nota")}
        </Button>
      </DemoGate>
    </>
  );
}
