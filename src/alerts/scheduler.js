/**
 * Simple interval-based scheduler — no external cron deps.
 * Each job has a name, interval (ms), and async callback.
 */

const jobs = new Map();

/**
 * Register a recurring job.
 * @param {string} name - unique job identifier
 * @param {number} intervalMs - run every N milliseconds
 * @param {Function} fn - async callback
 * @param {object} [opts]
 * @param {number} [opts.initialDelayMs] - delay before first run (default: intervalMs)
 */
export function schedule(name, intervalMs, fn, opts = {}) {
  if (jobs.has(name)) {
    const existing = jobs.get(name);
    if (existing.type === "interval") clearInterval(existing.timer);
    else clearTimeout(existing.timer);
  }

  const initialDelay = opts.initialDelayMs ?? intervalMs;

  const timeout = setTimeout(() => {
    // Run immediately after initial delay
    fn().catch((err) => {
      console.warn(`[alerts/scheduler] job '${name}' error: ${err.message}`);
    });

    // Then set the recurring interval
    const interval = setInterval(() => {
      fn().catch((err) => {
        console.warn(`[alerts/scheduler] job '${name}' error: ${err.message}`);
      });
    }, intervalMs);

    jobs.set(name, { timer: interval, intervalMs, fn, type: "interval" });
  }, initialDelay);

  jobs.set(name, { timer: timeout, intervalMs, fn, type: "timeout" });
}

/**
 * Reschedule an existing job with a new interval (e.g. escalation).
 */
export function reschedule(name, newIntervalMs) {
  const job = jobs.get(name);
  if (!job) return;

  if (job.type === "interval") clearInterval(job.timer);
  else clearTimeout(job.timer);

  const interval = setInterval(() => {
    job.fn().catch((err) => {
      console.warn(`[alerts/scheduler] job '${name}' error: ${err.message}`);
    });
  }, newIntervalMs);

  jobs.set(name, { ...job, timer: interval, intervalMs: newIntervalMs, type: "interval" });
}

/**
 * Cancel a specific job.
 */
export function cancel(name) {
  const job = jobs.get(name);
  if (!job) return;
  if (job.type === "interval") clearInterval(job.timer);
  else clearTimeout(job.timer);
  jobs.delete(name);
}

/**
 * Cancel all jobs. Called during shutdown.
 */
export function cancelAll() {
  for (const [, job] of jobs) {
    if (job.type === "interval") clearInterval(job.timer);
    else clearTimeout(job.timer);
  }
  jobs.clear();
}

/**
 * List active job names and intervals.
 */
export function listJobs() {
  const result = [];
  for (const [name, job] of jobs) {
    result.push({ name, intervalMs: job.intervalMs });
  }
  return result;
}
