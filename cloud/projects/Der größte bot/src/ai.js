const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');

const SYSTEM = `Du bist ein konservativer Trading-Risk-Analyst. Du bewertest Finanz-News
in Echtzeit auf ihren erwarteten kurzfristigen (Minuten bis Stunden) Preis-Impact
auf eine gegebene Instrumenten-Watchlist.

Regeln, die du strikt befolgst:
1. Wenn die News keinen klaren Marktbezug zu einem der Instrumente hat → action="NONE",
   confidence ≤ 0.3, instrument=null.
2. Bei Unsicherheit → niedrige Confidence. Hohe Confidence (>0.8) nur bei
   eindeutigem Marktbezug, klarer Richtung, und glaubwürdiger Quelle.
3. Du erfindest keine Fakten. Wenn die News-Snippet zu dünn ist, sag das via
   reasoning und gib niedrige Confidence.
4. "OPEN_TRADE" nur wenn confidence > 0.8 UND der News-Impact klar genug ist,
   dass ein Mensch sofort handeln würde. Sonst "FILTER_STRENGTHEN" (Strategie
   verschärfen), "FILTER_BLOCK" (Trades pausieren), "EMERGENCY_CLOSE" (offene
   Position schließen) oder "NONE".
5. Antwort IMMER strikt im vorgegebenen JSON-Schema, nichts dahinter, nichts davor.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action:     { type: 'string', enum: ['NONE', 'OPEN_TRADE', 'FILTER_STRENGTHEN', 'FILTER_BLOCK', 'EMERGENCY_CLOSE'] },
    instrument: { type: ['string', 'null'] },
    side:       { type: ['string', 'null'], enum: ['BUY', 'SELL', null] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    urgencyMin: { type: 'integer', minimum: 0, maximum: 1440 },
    reasoning:  { type: 'string', maxLength: 400 }
  },
  required: ['action', 'instrument', 'side', 'confidence', 'urgencyMin', 'reasoning']
};

class AiAdvisor {
  constructor({ apiKey, model = 'claude-opus-4-7' } = {}) {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY fehlt');
    this.client = new Anthropic({ apiKey });
    this.model  = model;
  }

  async score({ news, watchlist, recentLessons = '' }) {
    const stableContext =
      `Watchlist (nur diese Instrumente sind relevant): ${watchlist.join(', ')}\n\n` +
      `Lessons learned (aus Memory, beachten): ${recentLessons || '(keine)'}`;

    const userText = news
      .map((n, i) => `[${i + 1}] ${n.publishedAt} — ${n.source}\nTitel: ${n.title}\n${n.summary}`)
      .join('\n\n');

    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: 1500,
      thinking: { type: 'adaptive' },
      output_config: {
        format: { type: 'json_schema', schema: { type: 'array', items: SCHEMA, minItems: news.length, maxItems: news.length } }
      },
      system: [
        { type: 'text', text: SYSTEM },
        { type: 'text', text: stableContext, cache_control: { type: 'ephemeral' } }
      ],
      messages: [{
        role: 'user',
        content: `Bewerte jede der folgenden ${news.length} News-Items einzeln und gib ein JSON-Array mit ${news.length} Bewertungen zurück (gleiche Reihenfolge):\n\n${userText}`
      }]
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    if (!textBlock) return [];
    const raw = textBlock.text.trim();
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      const m = raw.match(/\[[\s\S]*\]/);
      if (m) { try { return JSON.parse(m[0]); } catch { /* fallthrough */ } }
      return [];
    }
  }
}

module.exports = { AiAdvisor };
