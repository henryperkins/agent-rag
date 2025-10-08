# XSS Vulnerability Fix - Citation Highlights

## Issue

**Severity**: P0 (Critical - Stored XSS)
**File**: `frontend/src/components/SourcesPanel.tsx`
**Lines**: 38-49 (before fix)

### Description

The component was rendering citation highlights from Azure Search using `dangerouslySetInnerHTML` without any sanitization. Azure Search returns highlights with HTML entities encoded (e.g., `&lt;script&gt;`), but when injected via `innerHTML`, the browser decodes them back into executable code.

**Attack Vector**:

- Malicious content uploaded to the search index
- Contains: `<script>alert('XSS')</script>` or similar
- Azure Search returns: `&lt;script&gt;alert('XSS')&lt;/script&gt;`
- Browser innerHTML decodes it back to: `<script>alert('XSS')</script>` → **Executes**

## Fix Applied

### Changes

1. **Installed DOMPurify** (`dompurify@3.2.7`)
   - Industry-standard HTML sanitization library
   - Actively maintained, used by major companies

2. **Created Sanitization Function**

   ```typescript
   function sanitizeHighlight(html: string): string {
     return DOMPurify.sanitize(html, {
       ALLOWED_TAGS: ['em'], // Only allow <em> tags for highlights
       ALLOWED_ATTR: [], // No attributes allowed
       KEEP_CONTENT: true, // Keep text content even if tags removed
     });
   }
   ```

3. **Applied to All Highlights**

   ```typescript
   // BEFORE (VULNERABLE):
   dangerouslySetInnerHTML={{ __html: highlight }}

   // AFTER (SAFE):
   dangerouslySetInnerHTML={{ __html: sanitizeHighlight(highlight) }}
   ```

### Security Properties

- ✅ **Strips all script tags** while preserving text content
- ✅ **Removes event handlers** (onclick, onerror, etc.)
- ✅ **Blocks dangerous tags** (iframe, object, embed, etc.)
- ✅ **Allows only `<em>` tags** which Azure Search uses for highlighting
- ✅ **Removes all attributes** to prevent attribute-based XSS
- ✅ **Handles HTML entity decoding** safely

### Examples

| Input                                   | Output             | Explanation                      |
| --------------------------------------- | ------------------ | -------------------------------- |
| `<em>keyword</em>`                      | `<em>keyword</em>` | ✅ Safe highlight preserved      |
| `<script>alert(1)</script>`             | `alert(1)`         | ✅ Script tag removed, text kept |
| `<em onclick="alert(1)">text</em>`      | `<em>text</em>`    | ✅ Event handler stripped        |
| `<img src=x onerror="alert(1)">`        | ``                 | ✅ Dangerous tag removed         |
| `&lt;script&gt;alert(1)&lt;/script&gt;` | `alert(1)`         | ✅ Decoded and sanitized         |

## Verification

### Manual Testing

To verify the fix is working:

1. Add malicious content to Azure Search index:

   ```json
   {
     "page_chunk": "Test <script>alert('XSS')</script> content"
   }
   ```

2. Trigger a search that returns this document

3. Check browser console - **no alert should fire**

4. Inspect HTML - script tag should be removed:
   ```html
   <div class="source-highlight">Test alert('XSS') content</div>
   ```

### Code Review Checklist

- [x] DOMPurify installed and imported
- [x] Sanitization function created with restrictive config
- [x] Applied to all highlight rendering
- [x] No other `dangerouslySetInnerHTML` usage in codebase
- [x] TypeScript compilation passes
- [x] Build succeeds

## Additional Recommendations

1. **Backend Validation** (Optional, defense-in-depth)
   - Consider sanitizing/validating content before indexing in Azure Search
   - However, client-side sanitization is still required as the source of truth

2. **Content Security Policy** (Recommended)
   - Add CSP headers to prevent inline script execution
   - Example: `Content-Security-Policy: script-src 'self'`

3. **Regular Audits**
   - Periodically scan for `dangerouslySetInnerHTML` usage
   - Review any new HTML rendering code

## References

- [DOMPurify Documentation](https://github.com/cure53/DOMPurify)
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [Azure Search Highlighting Docs](https://learn.microsoft.com/en-us/azure/search/search-pagination-page-layout#hit-highlighting)

---

**Fixed**: 2025-10-08
**Fixed By**: Claude Code
**Status**: ✅ Resolved
