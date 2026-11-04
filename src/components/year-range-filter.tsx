import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n";
import { currentYear, validateYearRange, type YearRange } from "@/lib/year-range";
import { cn } from "@/lib/utils";

type Props = {
  value: YearRange;
  customStart?: number;
  customEnd?: number;
  onChange: (range: YearRange, customStart?: number, customEnd?: number) => void;
};

export function YearRangeFilter({ value, customStart, customEnd, onChange }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [startInput, setStartInput] = useState(String(customStart ?? currentYear() - 4));
  const [endInput, setEndInput] = useState(String(customEnd ?? currentYear()));

  const options: { value: YearRange; label: string }[] = [
    { value: "1", label: t("1 tahun") },
    { value: "5", label: t("5 tahun") },
    { value: "10", label: t("10 tahun") },
    { value: "custom", label: t("Rentang khusus") },
  ];

  const handleSelect = (range: YearRange) => {
    if (range === "custom") {
      onChange("custom", customStart, customEnd);
      setOpen(true);
    } else {
      onChange(range);
    }
  };

  const handleApplyCustom = () => {
    const validated = validateYearRange(Number(startInput), Number(endInput));
    if (validated) {
      onChange("custom", validated.start, validated.end);
      setOpen(false);
    }
  };

  const label = value === "custom" && customStart && customEnd 
    ? `${customStart}–${customEnd}` 
    : options.find((o) => o.value === value)?.label ?? t("1 tahun");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((opt) => (
        <Button
          key={opt.value}
          variant={value === opt.value ? "default" : "outline"}
          size="sm"
          onClick={() => handleSelect(opt.value)}
          className={cn(opt.value === "custom" && "hidden sm:inline-flex")}
        >
          {opt.label}
        </Button>
      ))}
      <Popover open={open && value === "custom"} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={value === "custom" ? "default" : "outline"}
            size="sm"
            className="sm:hidden"
          >
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64" align="start">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="start-year">{t("Tahun awal")}</Label>
              <Input
                id="start-year"
                type="number"
                min={2000}
                max={2100}
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="end-year">{t("Tahun akhir")}</Label>
              <Input
                id="end-year"
                type="number"
                min={2000}
                max={2100}
                value={endInput}
                onChange={(e) => setEndInput(e.target.value)}
              />
            </div>
            <Button onClick={handleApplyCustom} className="w-full">
              {t("Terapkan")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
