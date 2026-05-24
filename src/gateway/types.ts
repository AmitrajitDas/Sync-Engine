export interface SyncUser {
  sub: string;
  tenantId: string;
  tenantSlug: string;
  region: string;
  roles: string[];
  jti?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: SyncUser;
    buckets: string[];
  }
}
