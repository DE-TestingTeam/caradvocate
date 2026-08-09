/**
 * Runs a REAL Supabase access token through the API's own verification, and reports what it found.
 *
 *   npm run verify:token          # paste the token when prompted (nothing is echoed)
 *
 * WHY THIS EXISTS: token verification is the one thing in this app that has never been exercised
 * against a genuine token. Every check in auth/verifyToken.ts -- issuer, audience, subject, email
 * -- is an assumption about the shape of what Supabase issues, and an assumption about a security
 * boundary is worth about as much as an untested backup. The failure mode is not subtle either:
 * pin the wrong issuer and nobody can sign in; forget to pin it and a validly-signed token from
 * ANY Supabase project authenticates here.
 *
 * WHERE TO GET A TOKEN. Sign in to the app, open the browser console, and run:
 *
 *   JSON.parse(localStorage[Object.keys(localStorage).find(k => k.endsWith('-auth-token'))]).access_token
 *
 * THE TOKEN IS NEVER PRINTED, and it is read from stdin rather than an argument or an environment
 * variable so it does not land in shell history or a process list. It is a live credential for as
 * long as it lasts (an hour by default): treat the paste as you would a password. The email in the
 * output is masked unless --show-email is passed, so this can be pasted into a chat or an issue.
 *
 * It calls the same `verifyAccessToken` the middleware calls. Not a reimplementation -- a
 * reimplementation would prove only that two pieces of code agree with each other.
 */
import { createInterface } from 'node:readline';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { expectedIssuer, isConfigured, jwksUrl, sharedSecret } from '../apps/api/src/auth/config.js';
import { verifyAccessToken } from '../apps/api/src/auth/verifyToken.js';

const showEmail = process.argv.includes('--show-email');

function mask(email: string): string {
  if (showEmail) return email;
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  return `${name.slice(0, 2)}***@${domain}`;
}

/** Reads one line with terminal echo off, so a pasted token is not left on screen. */
async function readToken(): Promise<string> {
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const wasRaw = process.stdin.isTTY;

  return new Promise((resolve) => {
    // `_writeToOutput` is readline's own hook; overriding it is the standard way to suppress echo.
    (input as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    process.stdout.write('Paste the access token (input hidden), then Enter:\n');
    input.question('', (answer) => {
      input.close();
      if (wasRaw) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
}

async function main(): Promise<void> {
  console.log('Verifying against this API\'s configuration');
  console.log(`  issuer expected : ${expectedIssuer() ?? '(none -- not pinned!)'}`);
  console.log(`  JWKS URL        : ${jwksUrl()?.toString() ?? '(none -- shared secret mode)'}`);
  console.log(`  shared secret   : ${sharedSecret() ? 'set' : 'not set'}`);
  console.log(`  configured      : ${isConfigured()}\n`);

  if (!isConfigured()) {
    throw new Error('This API has no way to verify a token. Set SUPABASE_URL or SUPABASE_JWT_SECRET.');
  }

  const token = await readToken();
  if (!token) throw new Error('No token given.');

  // Decoded WITHOUT verifying, purely to report what the token claims. The real check is below;
  // nothing here is trusted.
  const header = decodeProtectedHeader(token);
  const claims = decodeJwt(token);

  console.log('What the token says (unverified -- shown for comparison):');
  console.log(`  alg   : ${header.alg}`);
  console.log(`  kid   : ${header.kid ?? '(none)'}`);
  console.log(`  iss   : ${claims.iss}`);
  console.log(`  aud   : ${JSON.stringify(claims.aud)}`);
  console.log(`  sub   : ${claims.sub}`);
  console.log(`  email : ${typeof claims.email === 'string' ? mask(claims.email) : '(absent)'}`);
  console.log(`  role  : ${claims.role ?? '(absent)'}`);
  console.log(`  exp   : ${claims.exp ? new Date(claims.exp * 1000).toISOString() : '(absent)'}\n`);

  console.log('Each thing verifyToken.ts requires:');
  check('issuer matches what the API pins', claims.iss === expectedIssuer(),
    claims.iss === expectedIssuer() ? '' : `token says ${claims.iss}`);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  check("audience is 'authenticated'", aud.includes('authenticated'), `got ${JSON.stringify(claims.aud)}`);
  check('subject is a UUID', typeof claims.sub === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.sub));
  const email = typeof claims.email === 'string' ? claims.email
    : (claims.user_metadata as { email?: string } | undefined)?.email;
  check('an email is present', Boolean(email));
  check('not expired', typeof claims.exp === 'number' && claims.exp * 1000 > Date.now(),
    claims.exp ? `expires ${new Date(claims.exp * 1000).toISOString()}` : '');

  console.log('\nRunning the API\'s own verifyAccessToken:');
  try {
    const identity = await verifyAccessToken(token);
    check('signature and all claims verified', true);
    console.log(`\n  Resolved identity: ${identity.supabaseUserId} / ${mask(identity.email)}`);
    console.log('  This is the row the API would look up in users.supabase_user_id.');
  } catch (cause) {
    check('signature and all claims verified', false,
      `-> ${cause instanceof Error ? cause.message : String(cause)}`);
    console.log('\n  The API rejects this token. Compare the claims above against what it pins.');
  }

  // A token from another project must NOT authenticate here. Proven by tampering with the issuer:
  // if the pin is missing or wrong, this forged token sails through and the check fails loudly.
  console.log('\nNegative check -- a token from a different project must be rejected:');
  const [, body, sig] = token.split('.');
  const forgedClaims = { ...claims, iss: 'https://someone-elses-project.supabase.co/auth/v1' };
  const forged = `${token.split('.')[0]}.${Buffer.from(JSON.stringify(forgedClaims)).toString('base64url')}.${sig}`;
  void body;
  try {
    await verifyAccessToken(forged);
    check('a token with a foreign issuer is refused', false, '-> IT WAS ACCEPTED');
  } catch {
    check('a token with a foreign issuer is refused', true);
  }

  console.log(failures === 0
    ? '\nToken verification confirmed against a real Supabase token.'
    : `\n${failures} check(s) failed -- see above.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
