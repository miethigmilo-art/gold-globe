const Parser = require('rss-parser');
const crypto = require('crypto');

const DEFAULT_FEEDS = [
  'https://www.investing.com/rss/news_25.rss',
  'https://www.fxstreet.com/rss/news',
  'https://feeds.reuters.com/reuters/businessNews',
  'https://www.cnbc.com/id/10000664/device/rss/rss.html'
];

function hashId(item) {
  return crypto.createHash('sha1')
    .update((item.guid || item.link || '') + '|' + (item.title || ''))
    .digest('hex');
}

class NewsFeed {
  constructor({ feeds = DEFAULT_FEEDS, maxAgeMin = 60, maxItems = 20 } = {}) {
    this.feeds     = feeds;
    this.maxAgeMin = maxAgeMin;
    this.maxItems  = maxItems;
    this.parser    = new Parser({ timeout: 15000 });
    this.seen      = new Set();
  }

  setFeeds(feeds) {
    if (Array.isArray(feeds) && feeds.length) this.feeds = feeds;
  }

  async poll() {
    const cutoff = Date.now() - this.maxAgeMin * 60_000;
    const results = await Promise.allSettled(this.feeds.map(u => this.parser.parseURL(u)));
    const fresh = [];

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const item of (r.value.items || [])) {
        const id = hashId(item);
        if (this.seen.has(id)) continue;
        const t = item.isoDate ? Date.parse(item.isoDate) : (item.pubDate ? Date.parse(item.pubDate) : Date.now());
        if (t < cutoff) continue;
        this.seen.add(id);
        fresh.push({
          id,
          title:     (item.title || '').trim(),
          summary:   (item.contentSnippet || item.content || '').trim().slice(0, 600),
          link:      item.link,
          source:    r.value.title || 'rss',
          publishedAt: new Date(t).toISOString()
        });
      }
    }

    if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2000));
    fresh.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return fresh.slice(0, this.maxItems);
  }
}

module.exports = { NewsFeed, DEFAULT_FEEDS };
