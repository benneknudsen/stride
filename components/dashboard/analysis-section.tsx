import { AnalysisPanel } from "@/components/dashboard/analysis-panel";
import { auth } from "@/lib/auth";
import { getActivities } from "@/lib/db/queries";

/**
 * Server wrapper for the AI analysis panel on the live dashboard. Fetches the
 * athlete's recent activities and hands them to the client {@link AnalysisPanel},
 * which streams the generative-UI analysis on demand. Renders nothing until
 * there's data to reason about, so a freshly-connected account isn't shown an
 * empty panel.
 */
export async function AnalysisSection() {
  const session = await auth();
  const userId = session?.user?.id;
  const activities = userId ? await getActivities(userId, { limit: 60 }) : [];

  if (activities.length === 0) return null;

  return <AnalysisPanel activities={activities} scope="overall" />;
}
