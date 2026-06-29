import { Flag, Flame, Footprints, type LucideIcon, Zap } from "lucide-react";
import type { GoalKey } from "@/lib/training/goals";

/** Single source of truth for the per-goal glyph, shared by the picker tiles
 * and the committed-plan banner. */
export const GOAL_ICON: Record<GoalKey, LucideIcon> = {
  c25k: Footprints,
  marathon: Flag,
  zone2: Flame,
  efficient: Zap,
};
