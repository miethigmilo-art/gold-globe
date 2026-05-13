# Anweisungen für Claude (alle Sessions)

Dieses Repo enthält den **Gold Globe** — ein AI-powered 3D Gold Trading Dashboard, deployed via Vercel.

## Pflicht-Workflow für jede Session

### 1) Bevor du mit der Arbeit beginnst
```bash
git pull origin main
```
Hol den aktuellen Stand. Andere haben evtl. seit deiner letzten Session gepusht.

### 2) Nach jeder Code-Änderung
Sobald eine logische Einheit fertig ist (Bugfix, Feature), **immer**:
```bash
git add .
git commit -m "<beschreibender Text>"
git push origin <branch>
```

Frag den User **nicht** jedes Mal – einfach machen. Nur wenn:
- Mehrere unzusammenhängende Änderungen offen sind → in separate Commits aufteilen
- Du auf `main` direkt pushen willst und der Push fehlschlägt → über PR mergen

### 3) Bei Merge-Konflikten
- Versuche zuerst einen Rebase: `git pull --rebase origin main`
- Wenn Konflikte: dem User die betroffenen Stellen zeigen und entscheiden lassen
- **Nie** mit `--force` pushen, ohne nachzufragen

## Repo-Struktur

```
gold-globe/                  ← Repo-Root (deployed via Vercel)
├── server.js                ← Backend (Express, Trading-Bot-Proxy)
├── public/                  ← Frontend (Globe, Sidebar)
│   ├── index.html
│   ├── app.js
│   └── style.css
├── package.json
├── vercel.json
└── Procfile
```

## Wichtige URLs

- **Repo**: https://github.com/miethigmilo-art/gold-globe
- **Live**: https://gold-globe.vercel.app

## Was Claude eigenständig tun darf

- ✅ Code in `gold-globe/` (Repo-Root) ändern, committen, pushen
- ✅ Branches anlegen (`claude/<feature-name>`)
- ✅ Pull Requests erstellen wenn `main` geschützt ist

## Was Claude **nicht** ohne Rückfrage tun darf

- ❌ Repo auf privat umstellen
- ❌ Force-Push auf `main`
- ❌ Branches löschen (außer eigene Feature-Branches nach Merge)
- ❌ Git-Verlauf umschreiben (rebase auf shared branches)
- ❌ GitHub-Tokens oder Secrets ins Repo committen

## Commit-Stil

- **Format**: `<bereich>: <kurzbeschreibung>`
- **Sprache**: Deutsch oder Englisch (konsistent pro Commit)
- **Länge**: 1. Zeile max 72 Zeichen, danach Leerzeile + Details
- **Beispiele**:
  - `server: fix CORS bug für Mobile`
  - `ui: redesign Sidebar mit Drag-Handle`
  - `feat: add neue Trading-Strategie`

## Kontakt-Konvention

Wenn du als Claude im Auftrag eines Users arbeitest, der nicht der Repo-Owner
ist, und unsicher bist: lieber einmal nachfragen statt blind pushen.
