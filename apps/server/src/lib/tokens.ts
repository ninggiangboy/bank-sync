const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const TOKEN_LENGTH = 26;

/**
 * Random forwarding-address token: 26 lowercase base32 characters, 130 bits of entropy.
 * Each random byte is masked to 5 bits; 256 is a multiple of 32, so every character is uniform.
 */
export function newInboundToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH));
  let token = "";
  for (const byte of bytes) token += BASE32[byte & 31];
  return token;
}
