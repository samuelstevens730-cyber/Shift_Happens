import type { ReactNode } from "react";

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 p-4" onClick={() => onOpenChange(false)}>
      <div className="mx-auto mt-10 w-full max-w-4xl rounded-xl bg-white text-slate-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function DialogContent({ children }: { children: ReactNode }) {
  return <div className="p-4">{children}</div>;
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="mb-4 border-b border-slate-200 pb-3">{children}</div>;
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-semibold">{children}</h2>;
}

export function DialogDescription({ children }: { children: ReactNode }) {
  return <div className="text-sm text-slate-600">{children}</div>;
}
