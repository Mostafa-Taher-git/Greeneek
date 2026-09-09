import { useEffect, useState } from "react";

/** Returns true once the element has entered the viewport (once). */
export function useInView(
  ref: React.RefObject<Element | null>,
  threshold = 0.15,
): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
          }
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => { io.disconnect(); };
  }, [ref, threshold]);

  return inView;
}
