import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createResumeGuard, type PosResumeSteps, resumeLatest } from '../src/react/view/resume.js';

/**
 * The races CodeRabbit found on #70, each as the test that would have caught
 * it. The hook's `resume` is `resumeLatest` over the till's own setters, so
 * these run the same code without rendering anything.
 */

/** A read the test answers by hand, and a till that records what was put on it. */
function till() {
  const onTill: string[] = [];
  const errors: string[] = [];
  const reads: { answer: (id: string | null) => void; fail: () => void }[] = [];
  const steps = (): PosResumeSteps<string> => ({
    read: () =>
      new Promise<string | null>((resolve, reject) => {
        reads.push({ answer: resolve, fail: () => reject(new Error('offline')) });
      }),
    put: (order) => onTill.push(order),
    missing: () => errors.push('missing'),
    failed: () => errors.push('failed'),
  });
  return { onTill, errors, reads, steps };
}

describe('resumeLatest', () => {
  it('puts the order on the till and answers true', async () => {
    const guard = createResumeGuard();
    const t = till();
    const opening = resumeLatest(guard, false, t.steps());
    t.reads[0]?.answer('order-a');
    expect(await opening).toBe(true);
    expect(t.onTill).toEqual(['order-a']);
  });

  it('⚠ refuses while an act runs, and reads nothing', async () => {
    const guard = createResumeGuard();
    const t = till();
    expect(await resumeLatest(guard, true, t.steps())).toBe(false);
    expect(t.reads).toHaveLength(0);
    expect(t.onTill).toEqual([]);
  });

  it('⚠ never lets a superseded read replace the order — the first tap answering last', async () => {
    const guard = createResumeGuard();
    const t = till();
    const first = resumeLatest(guard, false, t.steps());
    const second = resumeLatest(guard, false, t.steps());
    t.reads[1]?.answer('order-b');
    t.reads[0]?.answer('order-a');
    expect(await second).toBe(true);
    expect(await first).toBe(false);
    expect(t.onTill).toEqual(['order-b']);
  });

  it('⚠ drops a read that lands after the till moved on: an act started, or it was cleared', async () => {
    const guard = createResumeGuard();
    const t = till();
    const opening = resumeLatest(guard, false, t.steps());
    guard.retire();
    t.reads[0]?.answer('order-a');
    expect(await opening).toBe(false);
    expect(t.onTill).toEqual([]);
  });

  it('says an order is gone, and says a failure only for the latest tap', async () => {
    const guard = createResumeGuard();
    const t = till();
    const gone = resumeLatest(guard, false, t.steps());
    t.reads[0]?.answer(null);
    expect(await gone).toBe(false);

    const replaced = resumeLatest(guard, false, t.steps());
    const latest = resumeLatest(guard, false, t.steps());
    t.reads[1]?.fail();
    t.reads[2]?.fail();
    expect(await replaced).toBe(false);
    expect(await latest).toBe(false);
    expect(t.errors).toEqual(['missing', 'failed']);
  });
});

/**
 * The callers. There are no React render tests here (testing rules), so the
 * wiring is checked by reading the source, as `live-status.test.ts` does.
 * ⚠ `__dirname`: this suite compiles to CommonJS.
 */
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('who opens a sheet after resume', () => {
  it.each([
    ['the phone Cashier', 'src/react/components/phone-cashier.tsx'],
    ['Take orders', 'src/react/components/take-orders.tsx'],
  ])('%s opens its order sheet only when resume answered true', (_name, path) => {
    const source = read(path);
    expect(source).toMatch(/if \(await state\.resume\([^)]*\)\) setSheet\('order'\);/);
    // Never the old shape: await, then open regardless.
    expect(source).not.toMatch(/await state\.resume\([^)]*\);\s*\n\s*setSheet\('order'\);/);
  });

  it('the Orders tab stops, and says why, when resume answered false', () => {
    expect(read('src/react/components/orders-section.tsx')).toMatch(
      /if \(!\(await state\.resume\(order\.id\)\)\) \{\s*\n\s*setError\(/,
    );
  });

  it('the hook’s resume is resumeLatest, retired by every act and every clear', () => {
    const hook = read('src/react/use-till.ts');
    expect(hook).toMatch(/resumeLatest\(resumeGuard, inFlight\.current,/);
    expect(hook.match(/resumeGuard\.retire\(\);/g)).toHaveLength(2);
  });
});
