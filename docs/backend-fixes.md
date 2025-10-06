# Backend Fixes

You can solve both issues with small, targeted tweaks:

- `backend/src/server.ts:60` — Wrap the timeout hook so the SSE endpoint opts out. For example:

  ```ts
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'POST' && request.url === '/chat/stream') {
      return; // don’t arm the timeout for long-lived streams
    }
    const timer = setTimeout(() => {
      reply.code(408).send({ error: 'Request timeout' });
    }, config.REQUEST_TIMEOUT_MS);
    reply.raw.on('close', () => clearTimeout(timer));
    reply.raw.on('finish', () => clearTimeout(timer));
  });
  ```

  That keeps the timeout protection for regular requests but prevents it from firing mid-stream.

- `backend/src/middleware/sanitize.ts:23` — Replace the `throw new Error(...)` cases with explicit 400 responses while you sanitize:

  ```ts
  const sanitizedMessages = [];
  for (const msg of body.messages) {
    if (typeof msg.content !== 'string') {
      reply.code(400).send({ error: 'Message content must be a string.' });
      return;
    }
    if (msg.content.length > MAX_MESSAGE_LENGTH) {
      reply.code(400).send({ error: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.` });
      return;
    }
    sanitizedMessages.push({
      role: msg.role,
      content: msg.content
        .replace(SCRIPT_REGEX, '')
        .replace(HTML_TAG_REGEX, '')
        .replace(/\s+/g, ' ')
        .trim()
    });
  }
  body.messages = sanitizedMessages;
  ```

  That way malformed payloads yield the expected 400 instead of bubbling up as 500s.
