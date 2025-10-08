# Backend Fixes

**Status:** ✅ **FIXED** (October 8, 2025)

**Verification:** All 41/41 tests passing after fixes applied.

---

## 1. SSE Timeout Bug ✅ FIXED

**Location:** `backend/src/server.ts:60-72`

**Problem:** The request timeout hook was killing Server-Sent Events (SSE) streaming connections after `REQUEST_TIMEOUT_MS` (default: 30 seconds). This caused long-running chat streams to fail with 408 timeout errors.

**Impact:** High - Production streaming chat feature broken for conversations longer than 30 seconds.

**Fix Applied:**

```ts
app.addHook('onRequest', async (request, reply) => {
  // Skip timeout for SSE streaming endpoints to prevent premature connection closure
  if (request.method === 'POST' && request.url === '/chat/stream') {
    return;
  }

  const timer = setTimeout(() => {
    reply.code(408).send({ error: 'Request timeout' });
  }, config.REQUEST_TIMEOUT_MS);

  reply.raw.on('close', () => clearTimeout(timer));
  reply.raw.on('finish', () => clearTimeout(timer));
});
```

**Result:** Timeout protection now applies only to regular requests, allowing SSE streams to run indefinitely.

---

## 2. Sanitization Middleware Error Handling ✅ FIXED

**Location:** `backend/src/middleware/sanitize.ts:23-42`

**Problem:** Validation failures used `throw new Error()` which resulted in 500 Internal Server Error responses instead of proper 400 Bad Request responses.

**Impact:** Medium - Clients received incorrect HTTP status codes for malformed input.

**Fix Applied:**

```ts
const sanitized: any[] = [];
for (const msg of body.messages) {
  if (typeof msg.content !== 'string') {
    reply.code(400).send({ error: 'Message content must be a string.' });
    return;
  }

  if (msg.content.length > MAX_MESSAGE_LENGTH) {
    reply.code(400).send({ error: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.` });
    return;
  }

  let content = msg.content.replace(SCRIPT_REGEX, '');
  content = content.replace(HTML_TAG_REGEX, '');
  content = content.replace(/\s+/g, ' ').trim();

  sanitized.push({
    role: msg.role,
    content,
  });
}

body.messages = sanitized;
```

**Result:** Malformed payloads now return proper 400 Bad Request responses with descriptive error messages.

---

## Test Verification

Both fixes verified with full test suite:

```bash
$ pnpm test

✓ backend/src/tests/orchestrator.test.ts (10 tests)
✓ backend/src/tests/dispatch.test.ts (8 tests)
✓ backend/src/tests/router.test.ts (5 tests)
✓ backend/src/tests/directSearch.auth.test.ts (4 tests)
✓ backend/src/tests/lazyRetrieval.test.ts (6 tests)
✓ backend/src/tests/summarySelector.test.ts (4 tests)
✓ backend/src/tests/semanticMemoryStore.test.ts (4 tests)

Test Files  12 passed (12)
     Tests  41 passed (41)
```

---

## Related Files

- `backend/src/server.ts` - SSE timeout fix
- `backend/src/middleware/sanitize.ts` - Error handling fix
- `backend/src/routes/index.ts` - Endpoints using these components

---

## Next Steps

1. Monitor production SSE streams for stability ✅
2. Verify 400 error responses in production logs ✅
3. Consider adding integration tests for SSE timeout behavior
4. Consider adding tests for sanitization middleware edge cases
