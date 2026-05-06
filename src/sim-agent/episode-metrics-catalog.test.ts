import { describe, it, expect } from 'vitest';
import {
  SIM_AGENT_EPISODE_ENVELOPE_DOT_PATHS,
  SIM_AGENT_EPISODE_SCHEMA_VALUE,
  SIM_AGENT_METRICS_DOT_PATHS,
  SIM_AGENT_SCENARIO_EXTRA_KEYS_KNOWN,
} from './episode-metrics-catalog.js';

describe('episode-metrics-catalog', () => {
  it('pins episode schema id for NDJSON filtering', () => {
    expect(SIM_AGENT_EPISODE_SCHEMA_VALUE).toBe('sim-agent-episode/1');
  });

  it('lists every scalar-ish metrics path except nested scenarioExtras blob', () => {
    expect(SIM_AGENT_METRICS_DOT_PATHS.length).toBeGreaterThan(5);
    expect(SIM_AGENT_METRICS_DOT_PATHS.some((p) => p.includes('scenarioExtras'))).toBe(false);
  });

  it('includes attribution paths for LaunchDarkly echo', () => {
    expect(SIM_AGENT_EPISODE_ENVELOPE_DOT_PATHS).toContain('launchDarkly.variationKey');
    expect(SIM_AGENT_EPISODE_ENVELOPE_DOT_PATHS).toContain('seed');
  });

  it('documents known scenarioExtras keys', () => {
    expect(SIM_AGENT_SCENARIO_EXTRA_KEYS_KNOWN.length).toBeGreaterThan(0);
  });
});
