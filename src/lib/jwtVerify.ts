/**
 * JWT Verification Utility for Employee PIN Auth
 * 
 * Verifies ES256 JWT tokens using the public key from JWT_SECRET env var.
 */
import { jwtVerify, JWTPayload, importJWK, JWK } from "jose";

const JWT_SECRET = process.env.JWT_SECRET;

export interface EmployeeJWTPayload extends JWTPayload {
  profile_id: string;
  store_ids: string[];
  store_id: string;
  role: string;
}

export async function verifyEmployeeJWT(token: string): Promise<EmployeeJWTPayload> {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable not set");
  }

  // Parse the JWK from JWT_SECRET (it's a JSON string containing the key)
  let jwk: JWK;
  try {
    jwk = JSON.parse(JWT_SECRET) as JWK;
  } catch {
    throw new Error("Invalid JWT_SECRET format - must be JSON JWK");
  }

  // Remove private key component 'd' to create public key
  const { d, ...publicJwk } = jwk;

  // Import the public key using jose's importJWK
  const publicKey = await importJWK(publicJwk, "ES256");

  // Verify the token
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: ["ES256"],
  });

  // Validate required fields
  if (!payload.profile_id || !Array.isArray(payload.store_ids)) {
    throw new Error("Invalid JWT payload - missing profile_id or store_ids");
  }

  return payload as EmployeeJWTPayload;
}

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}
