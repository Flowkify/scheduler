import * as React from "react";
import { useEffect, type ReactNode } from "react";

interface OverlayPortalProps {
  anchor: DOMRect;
  children: ReactNode;
  className: string;
  onDismiss: () => void;
  role?: "dialog" | "menu" | "tooltip";
  width?: number;
}

export function OverlayPortal({
  anchor,
  children,
  className,
  onDismiss,
  role = "dialog",
  width = 304
}: OverlayPortalProps): JSX.Element {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(`.${className}`)) onDismiss();
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", outside);
    };
  }, [className, onDismiss]);

  const margin = 12;
  const left = Math.max(
    margin,
    Math.min(anchor.left, window.innerWidth - width - margin)
  );
  const placeBelow = anchor.bottom + 190 < window.innerHeight;
  const style: React.CSSProperties = {
    position: "fixed",
    left,
    width,
    ...(placeBelow
      ? { top: anchor.bottom + 8 }
      : { bottom: window.innerHeight - anchor.top + 8 })
  };

  return (
    <div className={className} style={style} role={role}>
      {children}
    </div>
  );
}
