import { useEffect, useState } from "react";

/**
 * Startup "reveal" choreography shared by the Cobalt page clients (issue #138).
 *
 * Holds `loading` true for one beat after mount, then flips it so the page's
 * count-up numbers and staggered fade-up animations run exactly once — the
 * client-only entrance the server render can't stage. `started` is the inverse,
 * handed to child cards that gate their own animation on it. The timeout is
 * cleared on unmount so a fast navigation away can't reveal a torn-down tree.
 *
 * @param delayMs How long the loading overlay stays up before the reveal.
 */
export function useStartupReveal(delayMs = 300): { loading: boolean; started: boolean } {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return { loading, started: !loading };
}
