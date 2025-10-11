import type { FeatureFlag, FeatureOverrideMap, FeatureSource } from '../types';

interface FeatureTogglePanelProps {
  selections: FeatureOverrideMap;
  sources?: Partial<Record<FeatureFlag, FeatureSource>>;
  disabled?: boolean;
  onToggle: (flag: FeatureFlag, nextValue: boolean) => void;
}

interface ToggleDescriptor {
  flag: FeatureFlag;
  label: string;
  description: string;
  dependsOn?: FeatureFlag;
}

const FEATURE_TOGGLES: ToggleDescriptor[] = [
  {
    flag: 'ENABLE_MULTI_INDEX_FEDERATION',
    label: 'Multi-index federation',
    description: 'Merge results from additional Azure AI Search indexes before answering.'
  },
  {
    flag: 'ENABLE_LAZY_RETRIEVAL',
    label: 'Lazy retrieval',
    description: 'Fetch concise summaries first and hydrate full content only when the critic needs it.'
  },
  {
    flag: 'ENABLE_ADAPTIVE_RETRIEVAL',
    label: 'Adaptive retrieval',
    description: 'Automatically assess retrieval quality and reformulate queries when results are insufficient.'
  },
  {
    flag: 'ENABLE_SEMANTIC_SUMMARY',
    label: 'Semantic summary selection',
    description: 'Select running conversation summaries using embedding similarity instead of recency.'
  },
  {
    flag: 'ENABLE_INTENT_ROUTING',
    label: 'Intent routing',
    description: 'Choose specialized prompts and models per classified intent.'
  },
  {
    flag: 'ENABLE_SEMANTIC_MEMORY',
    label: 'Semantic memory',
    description: 'Recall and reuse previously stored semantic memories for follow-up questions.'
  },
  {
    flag: 'ENABLE_QUERY_DECOMPOSITION',
    label: 'Query decomposition',
    description: 'Break complex questions into sub-queries and synthesize the results.'
  },
  {
    flag: 'ENABLE_WEB_RERANKING',
    label: 'Web reranking',
    description: 'Fuse web results with retrieved documents using reciprocal rank fusion.'
  },
  {
    flag: 'ENABLE_SEMANTIC_BOOST',
    label: 'Semantic boost',
    description: 'Re-rank fused results using embedding similarity for relevance boosts.',
    dependsOn: 'ENABLE_WEB_RERANKING'
  },
  {
    flag: 'ENABLE_RESPONSE_STORAGE',
    label: 'Response storage',
    description: 'Persist answers in Azure OpenAI Responses for follow-up linking and history.'
  }
];

const SOURCE_LABEL: Record<FeatureSource, string> = {
  config: 'Default',
  persisted: 'Session',
  override: 'Override'
};

export function FeatureTogglePanel({ selections, sources, disabled, onToggle }: FeatureTogglePanelProps) {
  return (
    <section className="feature-panel">
      <header className="feature-panel__header">
        <h3>Feature Toggles</h3>
        <p>Enable additional retrieval and orchestration behaviors per session.</p>
      </header>
      <ul className="feature-panel__list">
        {FEATURE_TOGGLES.map((toggle) => {
          const currentValue = Boolean(selections?.[toggle.flag]);
          const dependencyMet = toggle.dependsOn ? Boolean(selections?.[toggle.dependsOn]) : true;
          const isDisabled = disabled || (!dependencyMet && !currentValue);
          const source = sources?.[toggle.flag];

          return (
            <li key={toggle.flag} className={`feature-panel__item${isDisabled ? ' feature-panel__item--disabled' : ''}`}>
              <label className="feature-panel__label">
                <input
                  type="checkbox"
                  checked={currentValue}
                  onChange={(event) => onToggle(toggle.flag, event.target.checked)}
                  disabled={isDisabled}
                />
                <div className="feature-panel__label-text">
                  <span>{toggle.label}</span>
                  {source && <span className={`feature-source feature-source-${source}`}>{SOURCE_LABEL[source]}</span>}
                </div>
              </label>
              <p className="feature-panel__description">{toggle.description}</p>
              {toggle.dependsOn && (
                <p className="feature-panel__hint">
                  Requires {FEATURE_TOGGLES.find((t) => t.flag === toggle.dependsOn)?.label ?? toggle.dependsOn}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
