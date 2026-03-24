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
    <div className="fixed inset-0 z-50 bg-black/70 p-4" onClick={() => onOpenChange(false)}>
      {children}
    </div>
  );
}

export function DialogContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`mx-auto mt-10 max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-cyan-400/30 bg-[#0b1220] p-4 text-slate-100 shadow-xl${className ? ` ${className}` : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="mb-4 border-b border-cyan-400/20 pb-3">{children}</div>;
}

export function DialogTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={`text-lg font-semibold${className ? ` ${className}` : ""}`}>{children}</h2>;
}

export function DialogDescription({ children }: { children: ReactNode }) {
  return <div className="text-sm text-slate-300">{children}</div>;
}
