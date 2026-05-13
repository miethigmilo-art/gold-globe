# 🗺️ AI Crawler — Projektplan

## Phase 1: Validierung (Woche 1–4)
**Ziel: Beweis dass das Produkt gebraucht wird — bevor eine Zeile Code geschrieben wird.**

### 1.1 Co-Founder Alignment
- Gemeinsames Verständnis der Idee festigen
- Rollen klären: Wer macht was? (Sales, Research, Technik später)
- Entscheidung: Wie viel Zeit pro Woche investiert jeder?

### 1.2 Marktrecherche vertiefen
- 5–10 direkte Konkurrenten analysieren (Firecrawl, llms.txt Projekte, GEO-Tools)
- Herausfinden: Was zahlen Unternehmen heute für SEO? → Benchmark für Pricing
- 10 potenzielle Testkunden identifizieren (lokale Unternehmen, Agenturen, SaaS-Firmen)

### 1.3 Ersten Testkandidaten finden
- Zielgruppe: Kleine Unternehmen oder Agenturen mit eigener Website
- Ansatz: Persönliches Netzwerk, LinkedIn, Kaltakquise
- Angebot: Kostenloser AI-Layer im Austausch gegen Feedback
- Ziel: 1 bestätigter Testkandidat

---

## Phase 2: Manueller Proof of Concept (Woche 5–8)
**Ziel: Zeigen dass der AI-Layer funktioniert — ohne eigene Software.**

### 2.1 AI-Layer manuell bauen
- Website des Testkandidaten crawlen (mit bestehenden Tools wie Firecrawl, Jina.ai)
- Inhalte in sauberes Markdown umwandeln
- `/llms.txt` + strukturierte Datei manuell erstellen und auf ihrer Domain hosten
- Endpoint dokumentieren

### 2.2 Wirkung messen
- **Vorher:** Screenshots wie ChatGPT, Perplexity, Claude das Unternehmen beschreiben
- **Nachher:** Dieselben Fragen stellen → Unterschied dokumentieren
- Metriken: Wird die Firma erwähnt? Sind Infos korrekt? Werden Produkte/Services genannt?

### 2.3 Feedback einholen
- Interview mit Testkandidaten: Würden sie dafür zahlen?
- Was war wertvoll? Was fehlte?
- Preisbereitschaft testen: "Was wäre dir das wert?"

---

## Phase 3: Erste zahlende Kunden (Woche 9–16)
**Ziel: 3–5 zahlende Kunden ohne eigene Technologie.**

### 3.1 Angebot schärfen
- Einfaches Paket definieren (z.B. Setup einmalig + monatliche Pflege)
- Landing Page bauen mit Vorher/Nachher-Beweis
- Pricing festlegen (Hypothese: €99–299/Monat)

### 3.2 Vertrieb starten
- Outreach über LinkedIn, Netzwerk, lokale Business-Events
- Case Study aus Phase 2 als Verkaufsargument nutzen
- Ziel: 3–5 zahlende Kunden gewinnen

### 3.3 Prozess manuell skalieren
- Für jeden neuen Kunden: manuell crawlen, strukturieren, hosten
- Learnings dokumentieren: Was ist repetitiv? Was braucht Automatisierung?

---

## Phase 4: Technologie bauen (ab Monat 4–5)
**Ziel: Was manuell funktioniert, automatisieren.**

### 4.1 Tech-Partner / Entwickler finden
- Mit Beweis (zahlende Kunden) ist es deutlich einfacher einen Entwickler zu finden
- Optionen: Technischer Co-Founder, Freelancer, No-Code-Lösung

### 4.2 MVP bauen
- Tool: URL eingeben → automatisch AI-Layer generieren
- Dashboard: Kunde sieht seinen Status, seinen Endpoint
- Verzeichnis: Erster Entwurf einer Registry AI-optimierter Seiten

### 4.3 Beta-Kunden einbinden
- Bestehende Kunden auf das Tool migrieren
- Feedback einbauen, iterieren

---

## Phase 5: Wachstum (ab Monat 6+)
- Verzeichnis ausbauen → Network Effect anstreben
- Analytics-Feature einführen ("X Agents haben deine Seite diese Woche aufgerufen")
- Pricing-Tiers definieren (Free / Pro / API)
- PR & Content: GEO ist ein heißes Thema → Early Mover Vorteil nutzen

---

## Offene Fragen (zu klären)
- [ ] Wie genau messen wir AI-Sichtbarkeit? (Tool / Methodik)
- [ ] Wer hostet den AI-Layer für den Kunden? (Vercel, eigene Infra?)
- [ ] Wie wird das Verzeichnis von Agents entdeckt? (das Kernproblem)
- [ ] Was ist das genaue Pricing-Modell?
- [ ] Brauchen wir rechtlich eine GmbH von Anfang an?

---

## Erfolgskriterien
| Phase | Ziel |
|-------|------|
| Phase 1 | 1 bestätigter Testkandidat |
| Phase 2 | Messbarer Unterschied durch AI-Layer nachgewiesen |
| Phase 3 | 3–5 zahlende Kunden |
| Phase 4 | Funktionierendes MVP |
| Phase 5 | 50+ Kunden, Verzeichnis mit Network Effect |

---

*Zuletzt aktualisiert: Mai 2026*
