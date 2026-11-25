import { test as base, expect } from '@playwright/test';

/**
 * Every spec imports `test` from here. It fails a test that leaves an uncaught page error or an unhandled promise
 * rejection behind (Playwright reports both as `weberror`), so a silent crash in the app can never pass the suite.
 * A spec that provokes one on purpose lists it: `test.use({ allowedPageErrors: [/message/] })`.
 */
export const test = base.extend<{ allowedPageErrors: RegExp[]; pageErrorGuard: void }>({
  allowedPageErrors: [[], { option: true }],
  pageErrorGuard: [
    async ({ context, allowedPageErrors }, use) => {
      const errors: string[] = [];
      context.on('weberror', (e) => {
        const m = e.error().stack ?? e.error().message;
        if (!allowedPageErrors.some((re) => re.test(m))) errors.push(m);
      });
      await use();
      expect(errors, 'uncaught page errors / unhandled rejections').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
