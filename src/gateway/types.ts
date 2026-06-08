/*
 * Gateway request context types.
 *
 * Auth plugin populates request.user. Tenant context plugin populates
 * request.buckets. Routes treat those as the current sync authorization scope.
 */
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
