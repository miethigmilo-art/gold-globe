const axios = require('axios');

class CapitalClient {
  constructor({ apiKey, email, password, baseUrl }) {
    this.apiKey   = apiKey;
    this.email    = email;
    this.password = password;
    this.baseUrl  = baseUrl;
    this.cst      = null;
    this.token    = null;
  }

  async login() {
    const r = await axios.post(`${this.baseUrl}/session`,
      { identifier: this.email, password: this.password },
      { headers: { 'X-CAP-API-KEY': this.apiKey, 'Content-Type': 'application/json' } });
    this.cst   = r.headers['cst'];
    this.token = r.headers['x-security-token'];
  }

  headers() {
    return { 'X-CAP-API-KEY': this.apiKey, 'CST': this.cst, 'X-SECURITY-TOKEN': this.token };
  }

  async request(method, path, body) {
    if (!this.cst) await this.login();
    try {
      const r = await axios({ method, url: `${this.baseUrl}${path}`, data: body, headers: this.headers() });
      return r.data;
    } catch (err) {
      if (err.response?.status === 401) {
        this.cst = null;
        await this.login();
        const r = await axios({ method, url: `${this.baseUrl}${path}`, data: body, headers: this.headers() });
        return r.data;
      }
      throw err;
    }
  }

  getMarket(epic)        { return this.request('GET',  `/markets/${epic}`); }
  searchMarkets(term)    { return this.request('GET',  `/markets?searchTerm=${encodeURIComponent(term)}`); }
  listPositions()        { return this.request('GET',  '/positions'); }
  getAccounts()          { return this.request('GET',  '/accounts'); }

  candles(epic, resolution = 'MINUTE_5', max = 200) {
    return this.request('GET', `/prices/${epic}?resolution=${resolution}&max=${max}`);
  }

  openPosition({ epic, direction, size, stopLevel, profitLevel }) {
    return this.request('POST', '/positions',
      { epic, direction, size, stopLevel, profitLevel, guaranteedStop: false });
  }

  closePosition(dealId) {
    return this.request('DELETE', `/positions/${dealId}`);
  }

  updateStop(dealId, stopLevel) {
    return this.request('PUT', `/positions/${dealId}`, { stopLevel });
  }
}

module.exports = { CapitalClient };
