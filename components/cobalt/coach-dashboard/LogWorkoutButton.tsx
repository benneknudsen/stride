"use client";

import { useState } from "react";

// "Logfør dette pas" quick action. Local optimistic state only — the demo has
// no persistence endpoint yet, so the button confirms in place.
export function LogWorkoutButton({ disabled = false }: { disabled?: boolean }) {
  const [logged, setLogged] = useState(false);

  return (
    <button
      type="button"
      disabled={disabled || logged}
      onClick={() => setLogged(true)}
      className="rounded-pill bg-silver px-[18px] py-[9px] text-[12.5px] font-semibold text-cobalt transition-colors hover:bg-white disabled:cursor-default disabled:opacity-60"
    >
      {logged ? "Logført ✓" : "Logfør dette pas"}
    </button>
  );
}
