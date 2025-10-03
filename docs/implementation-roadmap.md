# Implementation Roadmap: Liner-Inspired Enhancements

**Project:** Agent-RAG Enhancement Initiative
**Timeline:** 12 months (4 quarters)
**Priority:** Incremental feature delivery with backward compatibility

---

## Quick Reference: Feature Status

| Feature | Priority | Complexity | Timeline | Dependencies |
|---------|----------|------------|----------|--------------|
| **PDF Upload** | HIGH | Medium | Sprint 1-2 | Multipart, PDF parser |
| **Query History** | HIGH | Low | Sprint 1 | SQLite DB |
| **Citation Export** | HIGH | Low | Sprint 2-3 | None |
| **User Sessions** | MEDIUM | Medium | Sprint 1 | Database |
| **Collections** | MEDIUM | High | Sprint 4-6 | Database, Auth |
| **Browser Extension** | MEDIUM | High | Sprint 7-9 | Extension APIs |
| **Image Analysis** | LOW | Medium | Sprint 10+ | Azure Vision |
| **Video Processing** | LOW | High | Sprint 11+ | YouTube API |

---

## Q1 2026: Foundation & Core Features

### Sprint 1-2: Database & Session Management
**Goal:** Establish persistent storage and user session tracking

#### Week 1-2: Database Setup
```bash
# Install dependencies
cd backend
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3

# Create directory structure
mkdir -p data
mkdir -p src/services
```

**Deliverables:**
- [ ] SQLite database service (`src/services/database.ts`)
- [ ] Session table schema
- [ ] Query history table schema
- [ ] Session CRUD operations
- [ ] History retrieval endpoints
- [ ] Unit tests for database service

**Files to Create/Modify:**
- `backend/src/services/database.ts` (NEW)
- `backend/src/routes/index.ts` (UPDATE)
- `backend/src/services/enhancedChatService.ts` (UPDATE)
- `backend/src/services/chatStreamService.ts` (UPDATE)

#### Week 3-4: PDF Upload Infrastructure
**Goal:** Enable document upload and processing

**Deliverables:**
- [ ] Multipart form handling
- [ ] PDF parsing with pdf-parse
- [ ] Text chunking algorithm
- [ ] Embedding generation integration
- [ ] Azure Search index updates
- [ ] Upload endpoint (`POST /documents/upload`)
- [ ] Frontend upload component

**Files to Create/Modify:**
- `backend/src/tools/documentProcessor.ts` (NEW)
- `backend/src/azure/indexSetup.ts` (UPDATE - add document fields)
- `backend/src/routes/index.ts` (UPDATE - add upload route)
- `frontend/src/components/DocumentUpload.tsx` (NEW)
- `frontend/src/api/client.ts` (UPDATE)

**Testing Checklist:**
```typescript
✓ Upload 1MB PDF - processes correctly
✓ Upload 10MB PDF - handles size limit
✓ Invalid file type - rejects gracefully
✓ Concurrent uploads - no conflicts
✓ Failed embedding - error handling
```

---

### Sprint 3-4: Citation Management

#### Week 5-6: Citation Formatting
**Goal:** Export citations in multiple academic formats

**Deliverables:**
- [ ] Citation formatter utility
- [ ] APA format support
- [ ] MLA format support
- [ ] Chicago format support
- [ ] BibTeX format support
- [ ] Export endpoint
- [ ] Frontend export buttons

**Files to Create/Modify:**
- `backend/src/utils/citations.ts` (NEW)
- `backend/src/routes/index.ts` (UPDATE)
- `frontend/src/components/SourcesPanel.tsx` (UPDATE)
- `frontend/src/api/client.ts` (UPDATE)

**Quality Gates:**
```
✓ APA format validates against Purdue OWL
✓ BibTeX compiles without errors
✓ Export handles missing metadata
✓ Download triggers correctly
✓ Multiple citations export together
```

#### Week 7-8: History UI & Polish
**Goal:** User-friendly interface for session history

**Deliverables:**
- [ ] History panel component
- [ ] Session list view
- [ ] Query replay functionality
- [ ] Search within history
- [ ] Export history to file
- [ ] Delete history entries

**Files to Create/Modify:**
- `frontend/src/components/HistoryPanel.tsx` (NEW)
- `frontend/src/components/SessionList.tsx` (NEW)
- `frontend/src/App.tsx` (UPDATE - add history panel)
- `frontend/src/App.css` (UPDATE - add styles)

---

## Q2 2026: Collections & Organization

### Sprint 5-8: Collection Management System

#### Week 9-10: Collection Backend
**Goal:** Database and API for collections

**Schema Design:**
```sql
collections
├── id (PK)
├── user_id
├── name
├── description
├── created_at
└── updated_at

collection_items
├── id (PK)
├── collection_id (FK)
├── item_type (document|query|citation)
├── item_id
├── note
└── added_at

tags
├── id (PK)
├── user_id
├── name
└── color

collection_tags
├── collection_id (FK)
└── tag_id (FK)
```

**Deliverables:**
- [ ] Collection database schema
- [ ] Collection service (`src/services/collections.ts`)
- [ ] Collection CRUD endpoints
- [ ] Tag management endpoints
- [ ] Add/remove items endpoints
- [ ] Search within collection

**API Endpoints:**
```typescript
POST   /collections              // Create
GET    /collections              // List user's collections
GET    /collections/:id          // Get collection
PUT    /collections/:id          // Update
DELETE /collections/:id          // Delete
POST   /collections/:id/items    // Add item
DELETE /collections/:id/items/:itemId  // Remove item
GET    /collections/:id/search   // Search in collection
POST   /collections/:id/tags     // Add tag
DELETE /collections/:id/tags/:tagId    // Remove tag
```

#### Week 11-12: Collection Frontend
**Goal:** UI for managing collections

**Components:**
- `CollectionsList.tsx` - List all collections
- `CollectionView.tsx` - View collection contents
- `CollectionEditor.tsx` - Create/edit collection
- `AddToCollectionButton.tsx` - Quick-add widget
- `TagManager.tsx` - Manage tags

**User Flows:**
1. Create collection from chat
2. Add current citations to collection
3. Browse collection contents
4. Search within collection
5. Share collection (future: export/public link)

#### Week 13-16: Tags & Advanced Organization

**Deliverables:**
- [ ] Tag creation and management
- [ ] Tag-based filtering
- [ ] Collection search
- [ ] Bulk operations (add multiple items)
- [ ] Collection export (PDF, Markdown)
- [ ] Collection statistics

---

## Q3 2026: Browser Extension & Multi-Platform

### Sprint 9-12: Browser Extension

#### Week 17-20: Extension Core

**Project Structure:**
```
browser-extension/
├── manifest.json (Chrome Extension Manifest V3)
├── src/
│   ├── background/
│   │   └── service-worker.ts
│   ├── content/
│   │   ├── highlighter.ts
│   │   ├── sidebar.tsx
│   │   └── content.css
│   ├── popup/
│   │   ├── Popup.tsx
│   │   ├── SearchView.tsx
│   │   └── SettingsView.tsx
│   └── utils/
│       ├── api.ts
│       ├── storage.ts
│       └── messaging.ts
├── public/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── vite.config.ts
```

**Features:**
1. **Text Highlighting**
   - Select text on any webpage
   - Visual highlight overlay
   - Save highlight to backend
   - Sync across devices

2. **Quick Search**
   - Popup search interface
   - Connect to Agent-RAG backend
   - Display results inline
   - Add to collections

3. **Context Menu**
   - Right-click selected text
   - "Search with Agent-RAG"
   - "Add to Collection"
   - "Save Highlight"

**Technical Requirements:**
- Vite for building
- React for UI
- Chrome Storage API
- Message passing to backend
- OAuth for authentication

#### Week 21-24: Extension Advanced Features

**Deliverables:**
- [ ] Sidebar panel for full chat
- [ ] Offline mode with local cache
- [ ] Keyboard shortcuts
- [ ] Dark mode support
- [ ] Cross-browser compatibility (Firefox)
- [ ] Publish to Chrome Web Store

---

## Q4 2026: Multi-Modal & Advanced Features

### Sprint 13-14: Image Analysis

#### Week 25-28: Vision Integration

**Setup:**
```bash
pnpm add @azure/cognitiveservices-computervision
pnpm add @azure/ms-rest-azure-js
pnpm add sharp  # Image processing
```

**Features:**
1. **Image Upload & Analysis**
   - Upload images via drag-drop
   - Extract text (OCR)
   - Detect objects and scenes
   - Generate searchable captions

2. **Integration with Search**
   - Index image descriptions
   - Search by visual content
   - Related image recommendations

**Deliverables:**
- [ ] Image upload endpoint
- [ ] Azure Vision API integration
- [ ] Image analysis service
- [ ] OCR text extraction
- [ ] Image metadata storage
- [ ] Frontend image viewer

### Sprint 15-16: YouTube Video Support

#### Week 29-32: Video Processing

**Features:**
1. **Video URL Input**
   - Paste YouTube URL
   - Extract video metadata
   - Download transcript/captions

2. **Transcript Processing**
   - Chunk by timestamps
   - Create embeddings
   - Enable semantic search
   - Timestamp-based navigation

3. **Video Summarization**
   - Key moments extraction
   - Chapter detection
   - Summary with timestamps

**Deliverables:**
- [ ] YouTube API integration
- [ ] Transcript extraction
- [ ] Timestamp-based chunking
- [ ] Video metadata indexing
- [ ] Frontend video player widget
- [ ] Timestamp navigation

---

## Implementation Checklist

### Before Starting Each Sprint

- [ ] Review dependencies and install packages
- [ ] Create feature branch (`feature/sprint-N-feature-name`)
- [ ] Update `.env.example` with new variables
- [ ] Write failing tests first (TDD)
- [ ] Update TypeScript types in `shared/types.ts`

### During Development

- [ ] Follow existing code patterns
- [ ] Add inline comments for complex logic
- [ ] Run `pnpm lint` before commits
- [ ] Run `pnpm test` before pushing
- [ ] Update API documentation
- [ ] Add telemetry/logging for new operations

### Before Merging

- [ ] All tests pass (`pnpm test`)
- [ ] No lint errors (`pnpm lint`)
- [ ] Build succeeds (`pnpm build`)
- [ ] Manual testing completed
- [ ] Documentation updated
- [ ] Migration guide written (if needed)
- [ ] PR review completed
- [ ] Merge to `main`

---

## Risk Management

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **PDF parsing failures** | High | Add fallback OCR, error handling |
| **Database performance** | Medium | Add indexes, implement pagination |
| **Extension review delays** | Low | Start Chrome Web Store process early |
| **API rate limits** | Medium | Implement caching, backoff |
| **Storage costs** | Medium | Implement cleanup policies |

### Dependency Risks

| Dependency | Risk | Mitigation |
|------------|------|------------|
| Azure AI Search | Service changes | Version pin, monitor announcements |
| OpenAI API | Rate limits | Implement queuing, backoff |
| YouTube API | Quota limits | Cache transcripts, rate limit |
| Chrome APIs | Breaking changes | Follow Manifest V3 best practices |

---

## Success Metrics

### Sprint-Level Metrics
- [ ] All acceptance criteria met
- [ ] Test coverage > 80%
- [ ] Zero critical bugs
- [ ] Performance within targets
- [ ] Documentation complete

### Quarterly Metrics

**Q1 (Foundation):**
- 100 documents uploaded and indexed
- 1000 queries stored in history
- 500 citations exported
- < 2s average upload time

**Q2 (Collections):**
- 50 collections created
- 1000 items saved to collections
- 100 tags created
- < 500ms collection load time

**Q3 (Extension):**
- 100 extension installs
- 500 highlights created
- 200 searches from extension
- < 1s extension search time

**Q4 (Multi-modal):**
- 100 images analyzed
- 50 videos processed
- 90% OCR accuracy
- < 5s video processing time

---

## Developer Resources

### Setup Scripts

Create `scripts/dev-setup.sh`:
```bash
#!/bin/bash
# Development environment setup

# Backend
cd backend
pnpm install
mkdir -p data
pnpm setup  # Creates index and agent

# Frontend
cd ../frontend
pnpm install

# Extension (when ready)
cd ../browser-extension
pnpm install
pnpm build

echo "✓ Development environment ready"
```

### Testing Scripts

Create `scripts/test-all.sh`:
```bash
#!/bin/bash
# Run all tests

cd backend
pnpm test
pnpm lint

cd ../frontend
pnpm build  # Frontend tests when added

echo "✓ All tests passed"
```

---

## Documentation Updates

### Files to Maintain

1. **README.md** - Update feature list after each sprint
2. **API.md** - Document new endpoints
3. **CHANGELOG.md** - Track changes per sprint
4. **DEPLOYMENT.md** - Update deployment steps
5. **ARCHITECTURE.md** - Update architecture diagrams

### User Documentation

Create:
- `docs/user-guide/upload-documents.md`
- `docs/user-guide/manage-collections.md`
- `docs/user-guide/export-citations.md`
- `docs/user-guide/browser-extension.md`

---

## Rollout Strategy

### Alpha Release (Q1)
- Internal testing only
- Core team + 10 beta testers
- Focus: PDF upload, history, citations

### Beta Release (Q2)
- 100 external users
- Feature: Collections
- Collect feedback, iterate

### Public Release (Q3)
- Browser extension launch
- Public documentation
- Marketing push

### Enterprise Release (Q4)
- Full feature set
- Multi-modal support
- Enterprise pricing/licensing

---

## Budget Considerations

### Azure Costs (Monthly Estimates)

| Service | Usage | Est. Cost |
|---------|-------|-----------|
| AI Search | 100GB index | $250 |
| OpenAI API | 10M tokens/mo | $200 |
| Blob Storage | 500GB | $10 |
| Vision API | 10K images | $50 |
| Bing Search | 5K queries | $25 |
| **Total** | | **$535/mo** |

### Development Costs

| Resource | Time | Cost |
|----------|------|------|
| Backend Dev | 6 months | - |
| Frontend Dev | 4 months | - |
| Extension Dev | 2 months | - |
| QA/Testing | 2 months | - |
| **Total** | **14 months** | - |

---

## Next Steps

1. **Review this roadmap** with team
2. **Prioritize features** based on user feedback
3. **Set up project tracking** (GitHub Projects/Jira)
4. **Create sprint planning** templates
5. **Start Sprint 1** - Database & Session Management

---

## Appendix: Code Templates

### New Route Template
```typescript
// backend/src/routes/feature.ts
import type { FastifyInstance } from 'fastify';

export async function registerFeatureRoutes(app: FastifyInstance) {
  app.get('/feature', async (request, reply) => {
    // Implementation
    return { status: 'ok' };
  });

  app.post('/feature', async (request, reply) => {
    // Implementation
    return { status: 'created' };
  });
}
```

### New Service Template
```typescript
// backend/src/services/feature.ts
import { config } from '../config/app.js';

export class FeatureService {
  constructor() {
    // Initialize
  }

  async operation(input: Type): Promise<Result> {
    // Implement
    return result;
  }
}

export const featureService = new FeatureService();
```

### New Component Template
```typescript
// frontend/src/components/Feature.tsx
import { useState } from 'react';

interface FeatureProps {
  prop: string;
}

export function Feature({ prop }: FeatureProps) {
  const [state, setState] = useState<Type>(initial);

  return (
    <div className="feature">
      {/* UI */}
    </div>
  );
}
```

---

**Last Updated:** October 3, 2025
**Version:** 1.0
**Owner:** Development Team
