type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
};

export function DatePicker({ label, value, onChange, min, max }: Props) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <input
        type="date"
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
