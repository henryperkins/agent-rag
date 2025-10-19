import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { FeatureTogglePanel } from '../FeatureTogglePanel';

describe('FeatureTogglePanel', () => {
  it('invokes onToggle when a feature selection changes', () => {
    const onToggle = vi.fn();
    render(<FeatureTogglePanel selections={{}} onToggle={onToggle} />);

    // Expand the panel first (it's collapsed by default)
    const header = screen.getByRole('button', { name: /feature toggles/i });
    fireEvent.click(header);

    const checkbox = screen.getByLabelText(/Multi-index federation/i);
    fireEvent.click(checkbox);

    expect(onToggle).toHaveBeenCalledWith('ENABLE_MULTI_INDEX_FEDERATION', true);
  });

  it('disables dependent toggles when prerequisites are off', () => {
    const onToggle = vi.fn();
    render(<FeatureTogglePanel selections={{}} onToggle={onToggle} />);

    // Expand the panel first (it's collapsed by default)
    const header = screen.getByRole('button', { name: /feature toggles/i });
    fireEvent.click(header);

    const boostToggle = screen.getByLabelText(/Semantic boost/i);
    expect(boostToggle).toBeDisabled();
  });

  it('enables dependent toggles when prerequisites are active', () => {
    const onToggle = vi.fn();
    render(
      <FeatureTogglePanel
        selections={{ ENABLE_WEB_RERANKING: true, ENABLE_SEMANTIC_BOOST: false }}
        onToggle={onToggle}
      />
    );

    // Expand the panel first (it's collapsed by default)
    const header = screen.getByRole('button', { name: /feature toggles/i });
    fireEvent.click(header);

    const boostToggle = screen.getByLabelText(/Semantic boost/i);
    expect(boostToggle).not.toBeDisabled();
    fireEvent.click(boostToggle);
    expect(onToggle).toHaveBeenLastCalledWith('ENABLE_SEMANTIC_BOOST', true);
  });
});
