/**
 * strava-webhook.ts — lokalt CLI til appens ene Strava push-subscription.
 *
 * En push-subscription er applikations-scoped: der er præcis én pr. Strava-app,
 * autentificeret med *applikationens* credentials (ikke en atlets bearer-token)
 * — se header-kommentaren i `lib/strava/client.ts`. Dette script er
 * operator-fladen over den livscyklus. Det afløser den tidligere HTTP-rute
 * under /api/strava/webhook (fjernet), og kører derfor UDEN admin-gate: det er
 * blot et lokalt værktøj, ikke en offentlig endpoint.
 *
 * Brug:
 *   npx tsx scripts/strava-webhook.ts inspect   # vis nuværende subscription
 *   npx tsx scripts/strava-webhook.ts create    # opret (idempotent)
 *   npx tsx scripts/strava-webhook.ts delete     # slet den aktive subscription
 *   npx tsx scripts/strava-webhook.ts delete 123 # slet en bestemt subscription-id
 *
 * Env (læses fra projektets `.env.local`, ellers `.env`):
 *   - STRAVA_CLIENT_ID            (påkrævet — applikations-credential)
 *   - STRAVA_CLIENT_SECRET        (påkrævet — applikations-credential)
 *   - STRAVA_WEBHOOK_CALLBACK_URL (valgfri — callback Strava POSTer events til;
 *                                  falder tilbage til default i client.ts)
 *   - STRAVA_VERIFY_TOKEN         (påkrævet ved `create` — handshake-token)
 */

import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  getWebhookSubscription,
} from "@/lib/strava/client";

// Indlæs projektets lokale env ind i process.env, så de genbrugte
// client-funktioner finder STRAVA_CLIENT_ID/SECRET m.fl. Node 20.12+ har
// process.loadEnvFile() indbygget — ingen dotenv-afhængighed nødvendig.
function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
      return;
    } catch {
      // Filen findes ikke — prøv den næste.
    }
  }
}

async function inspect(): Promise<void> {
  const subscription = await getWebhookSubscription();
  if (!subscription) {
    console.log("Ingen aktiv Strava webhook-subscription.");
    return;
  }
  console.log("Aktiv webhook-subscription:");
  console.log(JSON.stringify(subscription, null, 2));
}

async function create(): Promise<void> {
  // Idempotens er kalderens job (se createWebhookSubscription): Strava afviser
  // en ny POST med 400 mens én allerede findes, så short-circuit på den aktive.
  const existing = await getWebhookSubscription();
  if (existing) {
    console.log("Subscription findes allerede — intet oprettet:");
    console.log(JSON.stringify(existing, null, 2));
    return;
  }
  const subscription = await createWebhookSubscription();
  console.log("Oprettede webhook-subscription:");
  console.log(JSON.stringify(subscription, null, 2));
}

async function remove(idArg: string | undefined): Promise<void> {
  // Foretræk et eksplicit id; ellers slå den aktive subscription op, så en
  // kalder der ikke kender id'et stadig kan rive den ned.
  let id: number | null = null;
  if (idArg !== undefined) {
    const parsed = Number(idArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`Ugyldigt subscription-id: ${idArg}`);
    }
    id = parsed;
  } else {
    const existing = await getWebhookSubscription();
    id = existing?.id ?? null;
  }

  if (id === null) {
    console.log("Ingen aktiv webhook-subscription at slette.");
    return;
  }

  await deleteWebhookSubscription(id);
  console.log(`Slettede webhook-subscription ${id}.`);
}

async function main(): Promise<void> {
  loadEnv();

  const [command, arg] = process.argv.slice(2);
  switch (command) {
    case "inspect":
      await inspect();
      break;
    case "create":
      await create();
      break;
    case "delete":
      await remove(arg);
      break;
    default:
      console.error(
        "Ukendt kommando. Brug: npx tsx scripts/strava-webhook.ts <inspect|create|delete [id]>"
      );
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
