import type { HTMLAttributes, ReactNode, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function Table({ className = "", ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={`w-full caption-bottom text-sm ${className}`} {...props} />;
}

export function TableHeader({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`[&_tr]:border-b ${className}`} {...props} />;
}

export function TableBody({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={`[&_tr:last-child]:border-0 ${className}`} {...props} />;
}

export function TableRow({ className = "", ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`border-b transition-colors hover:bg-slate-50 ${className}`} {...props} />;
}

export function TableHead({ className = "", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={`h-10 px-2 text-left align-middle font-medium text-slate-600 ${className}`} {...props} />;
}

export function TableCell({ className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`p-2 align-middle ${className}`} {...props} />;
}

export function TableContainer({ children }: { children: ReactNode }) {
  return <div className="w-full overflow-auto rounded-md border border-slate-200 bg-white">{children}</div>;
}
