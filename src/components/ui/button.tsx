import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "default" | "outline" | "secondary" | "destructive";

function classesForVariant(variant: Variant): string {
  switch (variant) {
    case "outline":
      return "border border-slate-400 bg-transparent text-slate-900 hover:bg-slate-100";
    case "secondary":
      return "bg-slate-200 text-slate-900 hover:bg-slate-300";
    case "destructive":
      return "bg-red-600 text-white hover:bg-red-700";
    default:
      return "bg-black text-white hover:bg-slate-800";
  }
}

export function Button({
  variant = "default",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode }) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${classesForVariant(variant)} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
