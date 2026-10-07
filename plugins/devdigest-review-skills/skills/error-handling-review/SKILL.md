---
name: error-handling-review
description: Apply when the diff adds or changes a try/catch, a promise chain, an async call, an error response or a retry. Flag every path where a failure is lost, misreported or retried unsafely.
type: rubric
---
An error path runs rarely, so nobody notices when it breaks — until production
fails silently, returns a 500 for a typo in the request, or charges a card twice.
Review the failure paths of every changed function as carefully as the happy path.

**Flag it:**
1. **Swallowed error** — an empty `catch`, a `catch` that only logs and carries on as
   if the call succeeded, or `.catch(() => {})`. The caller can no longer tell
   failure from success.
2. **Lost cause** — a `catch` that throws a new error without the original
   (`throw new Error('save failed')`). Pass it on: `new Error('save failed', { cause: err })`
   or rethrow `err`.
3. **Floating promise** — an async call with no `await`, no `return` and no `.catch`
   (`saveAudit(entry);` inside an `async` function). Its rejection escapes every
   handler and can crash the process.
4. **Wrong status** — a catch-all that turns a validation or not-found error into a
   500, or a 4xx/5xx body that carries a stack trace, an SQL message or an internal
   path. Map known errors to their status; log the details, return a stable code.
5. **Unsafe retry** — a retry loop with no attempt cap or backoff, or a retry of a
   call that is not idempotent (a payment, an email, an insert) without an
   idempotency key.

**Check, for each changed `try`, `.catch`, `await` and error response:**
1. Name the failure that can happen there (network, validation, constraint, timeout).
2. Follow it: who sees it, with what status or value, and is the original error
   still attached?
3. Decide whether the code after the handler is still correct when the call failed.

**Report each finding:**
- Cite the line of the handler, the unawaited call or the response.
- Say which failure is lost or misreported, and what the caller or the user sees.
- Give the fix in one line (rethrow with `cause`, `await`, map to 404, add a cap).

**Severity:** a swallowed error on a write, payment or auth path, or a retried
non-idempotent call, is CRITICAL; a lost cause, a floating promise or a wrong status
is a WARNING; a log message without context is a SUGGESTION.

**Not a finding:** a `catch` that handles the error on purpose and says so (a cache
miss that falls back to the source, with a comment), or a best-effort call that is
documented as fire-and-forget and has its own `.catch` that logs.

**Bad** — the failure is swallowed and the caller reports success:

```ts
async function saveInvoice(invoice: Invoice) {
  try {
    await db.insert(invoices).values(invoice);
  } catch (err) {
    console.error(err);
  }
  sendReceipt(invoice.email); // not awaited
  return { ok: true };
}
```

**Good** — the failure reaches the caller with its cause, and the follow-up is awaited:

```ts
async function saveInvoice(invoice: Invoice) {
  try {
    await db.insert(invoices).values(invoice);
  } catch (err) {
    throw new InvoiceSaveError(`invoice ${invoice.id} was not saved`, { cause: err });
  }
  await sendReceipt(invoice.email);
  return { ok: true };
}
```
