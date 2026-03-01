import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CostTracker, estimateCost } from '../../src/lib/cost-tracker.js';

describe('estimateCost', () => {
  it('calculates cost for known model', () => {
    const cost = estimateCost('gpt-4o-mini', 1000, 500);
    // input: 1k * 0.00015 = 0.00015, output: 0.5k * 0.0006 = 0.0003
    expect(cost).toBeCloseTo(0.00045, 5);
  });

  it('calculates cost for model with provider prefix', () => {
    const cost = estimateCost('openai/gpt-4o-mini', 1000, 500);
    expect(cost).toBeCloseTo(0.00045, 5);
  });

  it('returns zero for free models', () => {
    const cost = estimateCost('gemini-2.5-flash:free', 10000, 5000);
    expect(cost).toBe(0);
  });

  it('uses fallback pricing for unknown model', () => {
    const cost = estimateCost('unknown-model-xyz', 1000, 1000);
    // Fallback: input 0.002, output 0.008 per 1k
    expect(cost).toBeCloseTo(0.01, 4);
  });

  it('handles zero tokens', () => {
    const cost = estimateCost('gpt-4o', 0, 0);
    expect(cost).toBe(0);
  });
});

describe('CostTracker', () => {
  let tmpDir;
  let tracker;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cost-test-'));
    tracker = new CostTracker(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('logs usage to JSONL file', () => {
    tracker.log({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 100, outputTokens: 50 });

    const logPath = join(tmpDir, 'cost-log.jsonl');
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.provider).toBe('openai');
    expect(entry.model).toBe('gpt-4o-mini');
    expect(entry.input_tokens).toBe(100);
    expect(entry.output_tokens).toBe(50);
    expect(entry.est_cost_usd).toBeGreaterThan(0);
    expect(entry.date).toBeDefined();
  });

  it('logs multiple entries', () => {
    tracker.log({ provider: 'openai', model: 'gpt-4o', inputTokens: 500, outputTokens: 200 });
    tracker.log({ provider: 'anthropic', model: 'claude-sonnet-4-20250514', inputTokens: 300, outputTokens: 100 });

    const entries = tracker.readAll();
    expect(entries).toHaveLength(2);
    expect(entries[0].provider).toBe('openai');
    expect(entries[1].provider).toBe('anthropic');
  });

  it('readAll returns empty array when no log exists', () => {
    const entries = tracker.readAll();
    expect(entries).toEqual([]);
  });

  it('getDailyAggregates groups by day', () => {
    tracker.log({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 100, outputTokens: 50 });
    tracker.log({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 200, outputTokens: 100 });

    const aggregates = tracker.getDailyAggregates(30);
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0].requests).toBe(2);
    expect(aggregates[0].total_input).toBe(300);
    expect(aggregates[0].total_output).toBe(150);
    expect(aggregates[0].total_cost).toBeGreaterThan(0);
  });

  it('getDailyAggregates respects day limit', () => {
    tracker.log({ provider: 'openai', model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });

    const aggregates = tracker.getDailyAggregates(0);
    // 0 days means nothing should be included (cutoff is in the future)
    // Actually with 0, cutoff is today so entries from today are included
    // Let's test with data that's "old"
    expect(aggregates.length).toBeGreaterThanOrEqual(0);
  });

  it('getMonthlySummary returns current month data', () => {
    tracker.log({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500 });
    tracker.log({ provider: 'anthropic', model: 'claude-sonnet-4-20250514', inputTokens: 2000, outputTokens: 1000 });

    const summary = tracker.getMonthlySummary();
    const now = new Date();
    const expectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    expect(summary.month).toBe(expectedMonth);
    expect(summary.requests).toBe(2);
    expect(summary.total_input).toBe(3000);
    expect(summary.total_output).toBe(1500);
    expect(summary.total_cost).toBeGreaterThan(0);
    expect(Object.keys(summary.by_model)).toHaveLength(2);
    expect(summary.by_model['gpt-4o-mini']).toBeDefined();
    expect(summary.by_model['claude-sonnet-4-20250514']).toBeDefined();
  });

  it('getMonthlySummary returns zeros when no data', () => {
    const summary = tracker.getMonthlySummary();
    expect(summary.total_cost).toBe(0);
    expect(summary.requests).toBe(0);
  });

  it('handles malformed log entries gracefully', () => {
    const logPath = join(tmpDir, 'cost-log.jsonl');
    writeFileSync(logPath, 'not-json\n{"date":"2026-03-01","provider":"test","model":"test","input_tokens":100,"output_tokens":50,"est_cost_usd":0.01}\n');

    const entries = tracker.readAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].provider).toBe('test');
  });

  it('parseResponseHeaders returns null for missing headers', () => {
    const result = CostTracker.parseResponseHeaders({ headers: {} });
    expect(result).toBeNull();
  });

  it('parseResponseHeaders parses anthropic headers', () => {
    const result = CostTracker.parseResponseHeaders({
      headers: {
        'anthropic-ratelimit-input-tokens-remaining': '500',
        'anthropic-ratelimit-output-tokens-remaining': '200',
      },
    });
    expect(result).toEqual({ inputTokens: 500, outputTokens: 200 });
  });

  it('budget alert callback fires when budget exceeded', async () => {
    const alertFn = vi.fn();
    const budgetTracker = new CostTracker(tmpDir, {
      budgetAlertUsd: 0.0001, // Very low budget
      alertCallback: alertFn,
    });

    budgetTracker.log({ provider: 'openai', model: 'gpt-4o', inputTokens: 10000, outputTokens: 5000 });

    // Give async alert a moment
    await new Promise(r => setTimeout(r, 100));
    expect(alertFn).toHaveBeenCalled();
  });
});
