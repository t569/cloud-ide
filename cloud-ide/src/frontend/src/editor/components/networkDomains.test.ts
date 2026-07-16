import { describe, it, expect } from 'vitest';
import { classifyDomains } from './networkDomains';
import type { NetworkPolicySpec } from '@cloud-ide/shared/types/sandbox';

const policy: NetworkPolicySpec = {
  defaultAction: 'deny',
  rules: [
    { action: 'allow', target: 'github.com' },
    { action: 'allow', target: 'registry.npmjs.org' },
    { action: 'allow', target: 'api.stripe.com' }, // env-declared, live since boot
  ],
};

describe('classifyDomains', () => {
  it('splits live policy into builtin vs env-declared, and flags not-yet-live as pending', () => {
    const g = classifyDomains(policy, ['api.stripe.com', 'api.nasa.gov']); // nasa added after boot
    expect(g.active).toEqual(['api.stripe.com']);
    expect(g.builtin).toEqual(['github.com', 'registry.npmjs.org']);
    expect(g.pending).toEqual(['api.nasa.gov']);
  });

  it('handles a missing policy (unenforced host, network route failed)', () => {
    const g = classifyDomains(null, ['api.nasa.gov']);
    expect(g.active).toEqual([]);
    expect(g.builtin).toEqual([]);
    expect(g.pending).toEqual(['api.nasa.gov']);
  });
});
