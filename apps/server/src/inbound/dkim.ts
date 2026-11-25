import { dkimVerify } from "mailauth";

export type DkimOutcome = {
  pass: boolean;
  /** The signing domain (`d=`) that proved the origin. */
  domain?: string;
  /** The From address the signature was checked against. */
  from?: string;
  /** DNS or similar trouble: the answer may differ if asked again. */
  temporaryFailure?: boolean;
};

export type DnsResolver = (name: string, rrtype: string) => Promise<unknown>;

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

/**
 * Checks that the message carries a DKIM signature from the sender's own domain. A signature
 * counts only when it passes, its `d=` equals the From domain or a parent of it, and it covers the
 * whole body (no `l=` tag, or one at least as long as the body). `Authentication-Results` and
 * `ARC-*` headers added by Google or Cloudflare are never consulted: only the signature is.
 */
export async function verifyDkim(
  raw: Uint8Array,
  options: { resolver?: DnsResolver } = {},
): Promise<DkimOutcome> {
  const result = await dkimVerify(Buffer.from(raw), {
    rejectRsaSha1: true,
    ...(options.resolver ? { resolver: options.resolver as never } : {}),
  });

  // One From header with one address; anything else is ambiguous about who the sender is.
  if (result.fromFields !== 1 || result.headerFrom.length !== 1) return { pass: false };
  const fromDomain = domainOf(result.headerFrom[0] as string);

  let temporaryFailure = false;
  for (const signature of result.results) {
    if (signature.status.result === "temperror") temporaryFailure = true;
    if (signature.status.result !== "pass" || !signature.signingDomain) continue;

    const signer = signature.signingDomain.toLowerCase();
    const aligned = fromDomain === signer || fromDomain.endsWith(`.${signer}`);
    const coversBody =
      !signature.canonBodyLengthLimited ||
      (signature.canonBodyLengthLimit ?? 0) >=
        (signature.canonBodyLengthTotal ?? Number.MAX_SAFE_INTEGER);
    if (aligned && coversBody)
      return { pass: true, domain: signer, from: result.headerFrom[0]?.toLowerCase() as string };
  }
  return temporaryFailure ? { pass: false, temporaryFailure: true } : { pass: false };
}
