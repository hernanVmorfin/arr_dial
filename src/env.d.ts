/// <reference types="astro/client" />
type Env = {
  SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string;
  MONDAY_API_TOKEN?: string; MONDAY_BOARD_ID?: string; MONDAY_CODE_STATUS_COLUMN?: string; MONDAY_WEBHOOK_SECRET?: string;
  PODIUM_CLIENT_ID?: string; PODIUM_CLIENT_SECRET?: string; PODIUM_REFRESH_TOKEN?: string; PODIUM_API_TOKEN?: string; PODIUM_LOCATION_UID?: string;
  KLAVIYO_PRIVATE_KEY?: string; KLAVIYO_SMS_LIST_ID?: string;
  TURNSTILE_SITE_KEY?: string; TURNSTILE_SECRET_KEY?: string;
  DIAL_IP_LIMITS?: string;
};
/* Injected at build time by Vite's define in astro.config.mjs; see /api/health. */
declare const __BUILD__: { commit: string; builtAt: string | null };
type Runtime<E> = import('@astrojs/cloudflare').Runtime<E>;
/* `admin` is set by src/middleware.ts on admin pages and /api/admin/* once the session checks out. */
declare namespace App { interface Locals extends Runtime<Env> { admin?: { email: string; name: string; uid: string } } }
