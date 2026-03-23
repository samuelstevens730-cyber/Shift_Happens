"use client";

import { useEffect, useRef, useState } from "react";

type RevealOnScrollProps = {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
};

export default function RevealOnScroll({
  children,
  className = "",
  delayMs = 0,
}: RevealOnScrollProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let rafId = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const reveal = () => {
      if (timeoutId) return;
      timeoutId = setTimeout(() => {
        rafId = window.requestAnimationFrame(() => setVisible(true));
      }, 24);
    };

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          reveal();
          observer.disconnect();
        }
      },
      {
        rootMargin: "0px 0px -6% 0px",
        threshold: 0.08,
      }
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      if (timeoutId) clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal-card ${visible ? "reveal-card-visible" : ""} ${className}`.trim()}
      style={{ transitionDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}
