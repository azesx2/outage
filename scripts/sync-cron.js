#!/usr/bin/env node
// Creates or updates the cron-job.org job that starts the update workflow every 30 minutes.
// GitHub's own schedule is best-effort and often skips runs; it stays as a backup.
//
// Env: CRONJOB_API_KEY (cron-job.org API key), DISPATCH_TOKEN (fine-grained GitHub token with
// Actions read/write on this repository), GITHUB_REPOSITORY ("owner/repo").
// The job stores DISPATCH_TOKEN in its request headers, so nothing here ever prints a job body.
import { pathToFileURL } from 'node:url';

const API = 'https://api.cron-job.org';
const TITLE = 'outage: update schedule';
const WORKFLOW = 'update.yml';
const REF = 'main';
const TIMEOUT_MS = 20_000;

/** The job's full definition; sent on every sync so manual edits are reverted. */
export function buildJob({ repository, token }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) {
    throw new Error(`Invalid GITHUB_REPOSITORY "${repository}"`);
  }
  return {
    title: TITLE,
    url: `https://api.github.com/repos/${repository}/actions/workflows/${WORKFLOW}/dispatches`,
    enabled: true,
    saveResponses: false,
    requestTimeout: 30,
    requestMethod: 1, // POST
    schedule: {
      timezone: 'UTC',
      expiresAt: 0,
      hours: [-1],
      mdays: [-1],
      minutes: [17, 47],
      months: [-1],
      wdays: [-1],
    },
    extendedData: {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': `cron-job.org (${repository})`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: REF }),
    },
    // Email the account owner if dispatching keeps failing, e.g. after the token expires.
    notification: { onFailure: true, onFailureCount: 3, onSuccess: true, onDisable: true },
  };
}

async function call(fetchImpl, apiKey, method, path, body) {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Only the status is reported: responses may echo the job, including its token header.
  if (!res.ok) throw new Error(`cron-job.org ${method} ${path} failed: HTTP ${res.status}`);
  return res.json();
}

/** Updates the job with our title, or creates it. Returns { action, jobId }. */
export async function syncJob({ apiKey, job, fetchImpl = fetch }) {
  const { jobs } = await call(fetchImpl, apiKey, 'GET', '/jobs');
  const matches = jobs.filter((j) => j.title === job.title);
  if (matches.length > 1) {
    throw new Error(
      `Found ${matches.length} jobs titled "${job.title}" (${matches.map((j) => j.jobId).join(', ')}); delete the extras`,
    );
  }
  if (matches.length === 1) {
    const { jobId } = matches[0];
    await call(fetchImpl, apiKey, 'PATCH', `/jobs/${jobId}`, { job });
    return { action: 'updated', jobId };
  }
  const { jobId } = await call(fetchImpl, apiKey, 'PUT', '/jobs', { job });
  return { action: 'created', jobId };
}

async function main() {
  const { CRONJOB_API_KEY: apiKey, DISPATCH_TOKEN: token, GITHUB_REPOSITORY } = process.env;
  if (!apiKey && !token) {
    console.log(
      '::warning::CRONJOB_API_KEY and DISPATCH_TOKEN are not set; skipping the cron-job.org sync.',
    );
    return;
  }
  if (!apiKey || !token) throw new Error('Set both CRONJOB_API_KEY and DISPATCH_TOKEN');
  const { action, jobId } = await syncJob({
    apiKey,
    job: buildJob({ repository: GITHUB_REPOSITORY, token }),
  });
  console.log(`cron-job.org: ${action} job ${jobId} ("${TITLE}")`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
