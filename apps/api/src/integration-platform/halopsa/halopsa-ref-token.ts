import { randomBytes } from 'crypto';

/** Crockford base32 (no I, L, O, U) so tokens are unambiguous when read aloud. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TOKEN_LENGTH = 8;

/**
 * Short, unique reference placed in every Halo ticket summary, e.g. `CAI-7Q2K9M4D`.
 * Used to find a ticket again after an ambiguous create (timeout before a response).
 */
export function generateRefToken(random: (size: number) => Buffer = randomBytes): string {
  const bytes = random(TOKEN_LENGTH);
  let out = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `CAI-${out}`;
}

export const REF_TOKEN_PATTERN = /^CAI-[0-9A-HJKMNP-TV-Z]{8}$/;
