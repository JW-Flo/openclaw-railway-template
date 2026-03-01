import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Hardcoded pricing per 1k tokens (input / output) in USD.
 * Updated as of early 2026.
 */
const MODEL_PRICING = {
  // Anthropic
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-haiku-3.5': { input: 0.0008, output: 0.004 },
  // OpenAI
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4.1': { input: 0.002, output: 0.008 },
  'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
  'gpt-4.1-nano': { input: 0.0001, output: 0.0004 },
  'o4-mini': { input: 0.0011, output: 0.0044 },
  // Google
  'gemini-2.5-flash': { input: 0.0, output: 0.0 },
  'gemini-2.5-flash:free': { input: 0.0, output: 0.0 },
  // OpenRouter
  'openrouter/auto': { input: 0.002, output: 0.008 },
  'qwen/qwen3-coder:free': { input: 0.0, output: 0.0 },
};

/**
 * Estimate cost from token counts and model name.
 * @param {string} model
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} estimated cost in USD
 */
export function estimateCost(model, inputTokens, outputTokens) {
  // Try exact match first, then strip provider prefix
  let pricing = MODEL_PRICING[model];
  if (!pricing) {
    const shortName = model.replace(/^(openai|anthropic|google|openrouter)\//, '');
    pricing = MODEL_PRICING[shortName];
  }
  if (!pricing) {
    // Fallback: rough estimate
    pricing = { input: 0.002, output: 0.008 };
  }
  return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
}

/**
 * Cost tracker — logs LLM usage to a JSONL file and provides aggregation.
 */
export class CostTracker {
  #logPath;
  #budgetAlertUsd;
  #budgetWebhook;
  #lastBudgetCheck;
  #alertCallback;

  /**
   * @param {string} stateDir — e.g. /data/.openclaw
   * @param {{ budgetAlertUsd?: number, budgetWebhook?: string, alertCallback?: (msg: string) => void }} [opts]
   */
  constructor(stateDir, opts = {}) {
    this.#logPath = join(stateDir, 'cost-log.jsonl');
    this.#budgetAlertUsd = opts.budgetAlertUsd || parseFloat(process.env.BUDGET_ALERT_USD || '0');
    this.#budgetWebhook = opts.budgetWebhook || process.env.BUDGET_ALERT_WEBHOOK?.trim() || '';
    this.#lastBudgetCheck = 0;
    this.#alertCallback = opts.alertCallback || null;
    mkdirSync(dirname(this.#logPath), { recursive: true });
  }

  /**
   * Log a usage entry.
   * @param {{ provider: string, model: string, inputTokens: number, outputTokens: number }} usage
   */
  log(usage) {
    const entry = {
      date: new Date().toISOString(),
      provider: usage.provider || 'unknown',
      model: usage.model || 'unknown',
      input_tokens: usage.inputTokens || 0,
      output_tokens: usage.outputTokens || 0,
      est_cost_usd: estimateCost(usage.model || '', usage.inputTokens || 0, usage.outputTokens || 0),
    };
    appendFileSync(this.#logPath, JSON.stringify(entry) + '\n');

    // Debounced budget check — max once per minute
    if (this.#budgetAlertUsd > 0 && Date.now() - this.#lastBudgetCheck > 60_000) {
      this.#lastBudgetCheck = Date.now();
      this.#checkBudget();
    }
  }

  /**
   * Parse usage from proxy response headers (Anthropic/OpenRouter style).
   * @param {import('http').IncomingMessage} proxyRes
   * @returns {{ inputTokens: number, outputTokens: number } | null}
   */
  static parseResponseHeaders(proxyRes) {
    const headers = proxyRes.headers || {};

    // Anthropic headers
    const inputUsed = parseInt(headers['anthropic-ratelimit-input-tokens-remaining'] || '0', 10);
    const outputUsed = parseInt(headers['anthropic-ratelimit-output-tokens-remaining'] || '0', 10);
    if (inputUsed || outputUsed) {
      return { inputTokens: inputUsed, outputTokens: outputUsed };
    }

    // OpenRouter / generic x-ratelimit headers
    const xInput = parseInt(headers['x-ratelimit-remaining-tokens'] || '0', 10);
    if (xInput) {
      return { inputTokens: xInput, outputTokens: 0 };
    }

    return null;
  }

  /**
   * Read all log entries.
   * @returns {Array<{ date: string, provider: string, model: string, input_tokens: number, output_tokens: number, est_cost_usd: number }>}
   */
  readAll() {
    if (!existsSync(this.#logPath)) return [];
    const lines = readFileSync(this.#logPath, 'utf8').trim().split('\n').filter(Boolean);
    const entries = [];
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    return entries;
  }

  /**
   * Get daily aggregate costs.
   * @param {number} [days=30]
   * @returns {Array<{ date: string, total_cost: number, total_input: number, total_output: number, requests: number }>}
   */
  getDailyAggregates(days = 30) {
    const entries = this.readAll();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const dailyMap = {};
    for (const e of entries) {
      if (new Date(e.date) < cutoff) continue;
      const day = e.date.slice(0, 10);
      if (!dailyMap[day]) {
        dailyMap[day] = { date: day, total_cost: 0, total_input: 0, total_output: 0, requests: 0 };
      }
      dailyMap[day].total_cost += e.est_cost_usd || 0;
      dailyMap[day].total_input += e.input_tokens || 0;
      dailyMap[day].total_output += e.output_tokens || 0;
      dailyMap[day].requests++;
    }

    return Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get monthly summary.
   * @returns {{ month: string, total_cost: number, total_input: number, total_output: number, requests: number, by_model: Record<string, { cost: number, requests: number }> }}
   */
  getMonthlySummary() {
    const entries = this.readAll();
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const summary = {
      month: monthStr,
      total_cost: 0,
      total_input: 0,
      total_output: 0,
      requests: 0,
      by_model: {},
    };

    for (const e of entries) {
      if (!e.date.startsWith(monthStr)) continue;
      summary.total_cost += e.est_cost_usd || 0;
      summary.total_input += e.input_tokens || 0;
      summary.total_output += e.output_tokens || 0;
      summary.requests++;

      const model = e.model || 'unknown';
      if (!summary.by_model[model]) {
        summary.by_model[model] = { cost: 0, requests: 0 };
      }
      summary.by_model[model].cost += e.est_cost_usd || 0;
      summary.by_model[model].requests++;
    }

    return summary;
  }

  /**
   * Check budget and fire alert if exceeded.
   */
  async #checkBudget() {
    const summary = this.getMonthlySummary();
    if (summary.total_cost < this.#budgetAlertUsd) return;

    const message = `Budget alert: Monthly cost $${summary.total_cost.toFixed(2)} exceeds limit $${this.#budgetAlertUsd.toFixed(2)} (${summary.requests} requests, ${summary.month})`;
    console.warn(`[cost-tracker] ${message}`);

    // Use callback (e.g. sendTelegramAlert)
    if (this.#alertCallback) {
      try { await this.#alertCallback(message); } catch { /* ignore */ }
    }

    // POST to webhook if configured
    if (this.#budgetWebhook) {
      try {
        await fetch(this.#budgetWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message, cost: summary.total_cost, limit: this.#budgetAlertUsd }),
          signal: AbortSignal.timeout(5000),
        });
      } catch (err) {
        console.warn(`[cost-tracker] webhook failed: ${err.message}`);
      }
    }
  }
}
