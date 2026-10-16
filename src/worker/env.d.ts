import type { SocialRoom } from "./do/SocialRoom";

export interface Env {
  ENVIRONMENT: string;
  SITE_NAME: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET?: string;
  DB: D1Database;
  CACHE: KVNamespace;
  MEDIA: R2Bucket;
  DOWNLOADS: R2Bucket;
  MODERATION_QUEUE: Queue;
  SEARCH_INDEX: VectorizeIndex;
  AI: Ai;
  EMAIL: SendEmail;
  SOCIAL_ROOM: DurableObjectNamespace<SocialRoom>;
}
