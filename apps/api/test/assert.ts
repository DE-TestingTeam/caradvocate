/** Minimal assertion helpers so the suite has no test-runner dependency. */
let failures = 0;
let total = 0;

export function section(name: string): void {
  console.log(`\n${name}`);
}

export function check(name: string, pass: boolean, detail = ''): void {
  total += 1;
  if (!pass) failures += 1;
  const suffix = !pass && detail ? ` (${detail})` : '';
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${suffix}`);
}

export function summary(): { total: number; failures: number } {
  return { total, failures };
}
