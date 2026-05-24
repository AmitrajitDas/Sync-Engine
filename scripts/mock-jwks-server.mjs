/**
 * Mock JWKS server for local testing.
 *
 * Generates an RSA-2048 keypair on startup, serves the public key as JWKS,
 * and exposes /sign to mint test JWTs.
 *
 * Usage:
 *   node scripts/mock-jwks-server.mjs
 *
 * Set JWKS_URL=http://localhost:4001/.well-known/jwks.json in .env
 */

import { createServer } from "node:http";
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { randomUUID } from "node:crypto";
import { createSign } from "node:crypto";

const PORT = 4001;
const KID = "test-key-1";
const ISSUER = "https://auth.wingsure.local";

// Generate RSA-2048 keypair
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// Build JWK from public key
const jwk = createPublicKey(publicKey).export({ format: "jwk" });
const jwks = {
  keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }],
};

function base64url(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function signJwt(payload) {
  const header = { alg: "RS256", typ: "JWT", kid: KID };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;
  const sign = createSign("RSA-SHA256");
  sign.update(data);
  const sig = sign.sign(privateKey, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `${data}.${sig}`;
}

function makeToken({
  sub = "user-001",
  tenant_id = "tenant-abc",
  tenant_slug = "acme",
  region = "west",
  roles = ["field_agent"],
  expiresInMs = 3600_000,
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub,
    tenant_id,
    tenant_slug,
    region,
    roles,
    iss: ISSUER,
    iat: now,
    exp: now + Math.floor(expiresInMs / 1000),
    jti: randomUUID(),
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/.well-known/jwks.json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(jwks));
    return;
  }

  if (url.pathname === "/sign" && req.method === "GET") {
    const sub = url.searchParams.get("sub") ?? "user-001";
    const tenant_id = url.searchParams.get("tenant_id") ?? "tenant-abc";
    const tenant_slug = url.searchParams.get("tenant_slug") ?? "acme";
    const region = url.searchParams.get("region") ?? "west";
    const roles = (url.searchParams.get("roles") ?? "field_agent").split(",");
    const expired = url.searchParams.get("expired") === "1";
    const token = makeToken({
      sub, tenant_id, tenant_slug, region, roles,
      expiresInMs: expired ? -1000 : 3600_000,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ token }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\nMock JWKS server running on http://localhost:${PORT}`);
  console.log(`JWKS URL: http://localhost:${PORT}/.well-known/jwks.json`);
  console.log(`\nExample tokens:`);

  const fieldAgent = makeToken({ roles: ["field_agent"] });
  const admin = makeToken({ roles: ["tenant_admin"] });
  const expired = makeToken({ expiresInMs: -1000 });

  console.log(`\nField agent token:\n${fieldAgent}`);
  console.log(`\nAdmin token:\n${admin}`);
  console.log(`\nExpired token:\n${expired}`);
  console.log(`\nOr GET http://localhost:${PORT}/sign?roles=field_agent&sub=user-001`);
  console.log(`\nSet in .env: JWT_ISSUER=${ISSUER}`);
});
