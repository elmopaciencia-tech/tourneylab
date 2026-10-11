// TourneyLab managed-publishing client. Credentials never cross into the renderer.
const { createReportArchive } = require('./report-bundle.cjs');

function createPublisherClient({
  safeStorage,
  fileSystem,
  credentialFile,
  fetchImpl = globalThis.fetch,
  openExternal = async () => {},
  baseUrl = process.env.TOURNEYLAB_PUBLISHER_URL || 'https://publish.tourneylab.app'
}) {
  let memoryCredential = null;

  function loadCredential() {
    if (memoryCredential) return memoryCredential;
    if (!safeStorage?.isEncryptionAvailable?.() || !fileSystem.existsSync(credentialFile)) return null;
    try {
      return JSON.parse(safeStorage.decryptString(fileSystem.readFileSync(credentialFile)));
    } catch {
      return null;
    }
  }

  function saveCredential(credential) {
    memoryCredential = credential;
    if (!safeStorage?.isEncryptionAvailable?.()) return false;
    fileSystem.mkdirSync(require('path').dirname(credentialFile), { recursive: true });
    fileSystem.writeFileSync(credentialFile, safeStorage.encryptString(JSON.stringify(credential)));
    try { fileSystem.chmodSync(credentialFile, 0o600); } catch {}
    return true;
  }

  async function request(path, options = {}, { authenticated = true } = {}) {
    const credential = loadCredential();
    if (authenticated && !credential?.token) {
      const error = new Error('Connect a TourneyLab publishing account first.');
      error.status = 401;
      throw error;
    }
    const headers = { ...(options.headers ?? {}) };
    if (authenticated) headers.Authorization = `Bearer ${credential.token}`;
    const response = await fetchImpl(`${baseUrl}${path}`, { ...options, headers });
    const contentType = response.headers?.get?.('content-type') ?? '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error(data?.error || `Publishing service returned ${response.status}.`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function jsonRequest(path, method, body, options = {}) {
    return request(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      body: body == null ? undefined : JSON.stringify(body)
    }, options);
  }

  return {
    async connection() {
      const credential = loadCredential();
      if (!credential) return { connected: false, persistent: false, account: null };
      return { connected: true, persistent: !!safeStorage?.isEncryptionAvailable?.(), account: credential.account ?? null };
    },
    async connectStart(deviceName) {
      const result = await jsonRequest('/v1/device/authorizations', 'POST', { deviceName }, { authenticated: false });
      await openExternal(result.verificationUrl);
      return result;
    },
    async connectPoll(deviceCode) {
      const result = await jsonRequest('/v1/device/token', 'POST', { deviceCode }, { authenticated: false });
      const persistent = saveCredential({ token: result.token, account: result.account ?? null });
      return { account: result.account ?? null, persistent };
    },
    async disconnect() {
      memoryCredential = null;
      if (fileSystem.existsSync(credentialFile)) {
        try { fileSystem.unlinkSync(credentialFile); } catch {}
      }
      return { connected: false };
    },
    createReport(title, visibility = 'listed') {
      return jsonRequest('/v1/reports', 'POST', { title, visibility });
    },
    report(reportId) { return request(`/v1/reports/${encodeURIComponent(reportId)}`); },
    publish(reportId, html, revision) {
      return request(`/v1/reports/${encodeURIComponent(reportId)}/html`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'If-Match': String(revision) },
        body: html
      });
    },
    publishBundle(reportId, bundle, revision) {
      const archive = createReportArchive(bundle);
      return request(`/v1/reports/${encodeURIComponent(reportId)}/bundle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/vnd.tourneylab.report-bundle', 'If-Match': String(revision) },
        body: archive
      });
    },
    updateReport(reportId, changes) { return jsonRequest(`/v1/reports/${encodeURIComponent(reportId)}`, 'PATCH', changes); },
    action(reportId, action, body) { return jsonRequest(`/v1/reports/${encodeURIComponent(reportId)}/${action}`, 'POST', body); },
    async checkout(reportId) {
      const result = await jsonRequest(`/v1/reports/${encodeURIComponent(reportId)}/checkout`, 'POST');
      if (result.url) await openExternal(result.url);
      return result;
    },
    async proCheckout() {
      const result = await jsonRequest('/v1/billing/pro-checkout', 'POST');
      if (result.url) await openExternal(result.url);
      return result;
    },
    async billingPortal() {
      const result = await jsonRequest('/v1/billing/portal', 'POST');
      if (result.url) await openExternal(result.url);
      return result;
    },
    openExternal
  };
}

module.exports = { createPublisherClient };
