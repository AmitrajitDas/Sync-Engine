import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import jwksRsa from "jwks-rsa";
import jwt from "jsonwebtoken";
import type { SyncUser } from "../types.js";
import { AuthError } from "./errorHandler.js";

export interface AuthPluginOptions {
  jwksUrl: string;
  issuer: string;
  audience?: string;
}

interface RbacJwtPayload {
  sub: string;
  tenant_id: string;
  tenant_slug: string;
  region: string;
  roles: string[];
  jti?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
}

declare module "fastify" {
  interface FastifyInstance {
    verifyToken(token: string): Promise<SyncUser>;
  }
}

export const authPlugin = fp(async function authPlugin(
  app: FastifyInstance,
  opts: AuthPluginOptions,
) {
  const jwksClient = jwksRsa({
    jwksUri: opts.jwksUrl,
    cache: true,
    cacheMaxEntries: 10,
    cacheMaxAge: 3600000,
  });

  function getKey(
    header: jwt.JwtHeader,
    callback: jwt.SigningKeyCallback,
  ): void {
    if (!header.kid) {
      callback(new AuthError("JWT missing kid header"));
      return;
    }
    jwksClient.getSigningKey(header.kid, (err, key) => {
      if (err || !key) {
        callback(new AuthError(`Failed to retrieve signing key: ${err?.message}`));
        return;
      }
      callback(null, key.getPublicKey());
    });
  }

  async function verifyToken(token: string): Promise<SyncUser> {
    return new Promise((resolve, reject) => {
      const verifyOptions: jwt.VerifyOptions = {
        algorithms: ["RS256"],
        issuer: opts.issuer,
      };
      if (opts.audience) verifyOptions.audience = opts.audience;

      jwt.verify(token, getKey, verifyOptions, (err, decoded) => {
        if (err) {
          reject(new AuthError(`Token verification failed: ${err.message}`));
          return;
        }
        const payload = decoded as RbacJwtPayload;
        if (!payload.sub || !payload.tenant_id || !payload.tenant_slug || !payload.region) {
          reject(new AuthError("JWT missing required claims"));
          return;
        }
        resolve({
          sub: payload.sub,
          tenantId: payload.tenant_id,
          tenantSlug: payload.tenant_slug,
          region: payload.region,
          roles: Array.isArray(payload.roles) ? payload.roles : [],
          jti: payload.jti,
        });
      });
    });
  }

  app.decorate("verifyToken", verifyToken);

  // SPEC-028 — onRequest so rate limit can see request.user.
  app.addHook(
    "onRequest",
    async (request: FastifyRequest, _reply: FastifyReply) => {
      if (!request.url.startsWith("/sync/")) return;

      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        throw new AuthError("Missing or malformed Authorization header");
      }

      const token = authHeader.slice(7);
      request.user = await verifyToken(token);
    },
  );
});
