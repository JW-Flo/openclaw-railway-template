class ApiError extends Error {
  constructor(status, body) {
    super(`API error ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

function getCsrfToken() {
  // Read from meta tag first (server-rendered pages)
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta) return meta.getAttribute('content');
  // Fall back to _csrf_token cookie
  const match = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('_csrf_token='));
  return match ? match.split('=')[1] : null;
}

async function request(method, path, body) {
  const opts = { method, headers: {} };
  // Include CSRF token on state-changing requests
  if (method !== 'GET') {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      opts.headers['X-CSRF-Token'] = csrfToken;
    }
  }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    let body;
    if (ct.includes('application/json')) {
      try {
        const json = await res.json();
        body = json.error || json.message || JSON.stringify(json);
      } catch {
        body = await res.text().catch(() => '');
      }
    } else {
      body = await res.text().catch(() => '');
    }
    throw new ApiError(res.status, body);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return { ok: true, output: await res.text() };
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
};

export { ApiError };
