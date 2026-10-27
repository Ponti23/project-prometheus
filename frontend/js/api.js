// Thin fetch wrapper for the Prometheus JSON API.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.detail ? (typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)) : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch (e) {
    throw new ApiError(0, { detail: "Prometheus server unreachable. Is it running?" });
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, b = {}) => request("POST", p, b),
  put: (p, b) => request("PUT", p, b),
  patch: (p, b) => request("PATCH", p, b),
  del: (p) => request("DELETE", p),
};
