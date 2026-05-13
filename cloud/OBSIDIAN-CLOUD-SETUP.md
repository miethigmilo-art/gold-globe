# Obsidian Cloud Setup – Anleitung zum Weiterleiten

> **Ziel**: Dein Obsidian Vault und alle Projekte automatisch via GitHub mit Claude (PC, iPad, Web) synchron halten.

---

## Was ist hier drin?

Dieser `cloud/`-Ordner im Repo `miethigmilo-art/gold-globe` ist deine **Cloud-Struktur**:

```
cloud/
├── OBSIDIAN-CLOUD-SETUP.md   ← Diese Anleitung
├── projects/
│   └── gold-globe/            ← Snapshot deines gold-globe Projekts
└── obsidian/                  ← Hier landen deine Obsidian-Notizen (nach Setup)
```

---

## Schritt-für-Schritt: Was du am PC tun musst

### 1) Repo auf den PC klonen (5 Min)

Öffne PowerShell / Terminal auf deinem PC:

```bash
cd Desktop
git clone https://github.com/miethigmilo-art/gold-globe.git
cd gold-globe
git checkout claude/setup-remote-pc-BRbm4
```

Du hast jetzt den ganzen Cloud-Ordner lokal auf dem Desktop.

---

### 2) Obsidian Vault in den Cloud-Ordner legen

Du hast zwei Möglichkeiten:

**Option A (empfohlen): Neuen Vault im Cloud-Ordner anlegen**
1. Obsidian öffnen → "Open folder as vault"
2. Wähle: `Desktop/gold-globe/cloud/obsidian`
3. Fertig – alle Notizen landen direkt in der Cloud.

**Option B: Bestehenden Vault verschieben**
1. Schließe Obsidian
2. Verschiebe deinen Desktop-Vault nach `Desktop/gold-globe/cloud/obsidian/`
3. Öffne in Obsidian den neuen Pfad

---

### 3) Obsidian Git Plugin installieren (Auto-Sync)

Dieses Plugin pusht **jede Änderung automatisch** zu GitHub – auch wenn du in Obsidian schreibst.

1. Obsidian → **Settings** → **Community plugins** → "Turn on community plugins"
2. **Browse** → Suche nach **"Obsidian Git"** (Autor: Vinzent Zeband)
3. **Install** → **Enable**
4. **Einstellungen öffnen** und folgendes setzen:

| Einstellung | Wert |
|---|---|
| Vault backup interval (minutes) | `5` |
| Auto pull interval (minutes) | `5` |
| Commit message | `vault backup: {{date}}` |
| Pull updates on startup | ✅ |
| Push updates on commit | ✅ |
| Disable push | ❌ |

5. **Wichtig**: Da der Vault im git-Unterordner liegt, muss das Plugin den Repo-Root erkennen. Falls Probleme: in Obsidian Git Settings → "Custom base path" auf `..` (zwei Punkte) setzen.

---

### 4) Authentifizierung für GitHub

Damit Obsidian Git pushen darf:

```bash
# Im Terminal, einmalig:
git config --global user.name "Dein Name"
git config --global user.email "deine@email.de"

# Personal Access Token holen:
# github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)
# → Generate new token → Scope "repo" anhaken → Token kopieren
```

Beim ersten Push fragt Git nach Username + Passwort. Statt Passwort → den Token einfügen.

---

### 5) Mit Claude Projects verbinden

1. Gehe auf **https://claude.ai** → linke Sidebar → **Projects** → **+ New Project**
2. Im Projekt: **Add content** → **Connect GitHub**
3. Wähle das Repo **`miethigmilo-art/gold-globe`**
4. Branch: `claude/setup-remote-pc-BRbm4` (oder `main`, je nachdem wo du arbeitest)
5. **Optional**: Pfad einschränken auf `cloud/` – dann sieht das Projekt nur die Cloud-Inhalte, nicht den Code

Ab jetzt:
- Schreibst du in Obsidian → Datei wird automatisch gepusht → Claude sieht es nach max. 5 Min
- Funktioniert auf **PC, Web (claude.ai/code) und iPad** (Claude iOS App)

---

### 6) Weitere Projekte hinzufügen

Wenn du ein neues Projekt machen willst:

```bash
cd Desktop/gold-globe/cloud/projects
mkdir mein-neues-projekt
# Dateien reinpacken, fertig
```

Beim nächsten Auto-Push landet es in der Cloud.

---

### 7) Claude Auto-Push einrichten (optional aber empfohlen)

Damit **Claude Code** auf deinem PC nach jeder Code-Änderung automatisch
committet und pusht – ohne dass du es ihm sagen musst.

**Option A: Via `CLAUDE.md` (geht ohne weiteres Setup)**

Die Datei `CLAUDE.md` im Repo-Root weist jede Claude-Session an, nach
Änderungen automatisch zu pushen. Funktioniert in jeder Claude-Session
(PC, Web, iPad).

**Option B: Via Hook (Hard-Enforcement)**

Falls Claude trotzdem mal vergisst – hinzufügen in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "cd \"$CLAUDE_PROJECT_DIR\" && git add -A && git diff --cached --quiet || (git commit -m \"claude: auto-sync $(date +%H:%M)\" && git push origin HEAD)"
          }
        ]
      }
    ]
  }
}
```

Das pusht **nach jedem Tool-Use** von Edit/Write automatisch. Vorsicht:
Auch unfertige Änderungen landen sofort in der Cloud.

---

## Troubleshooting

| Problem | Lösung |
|---|---|
| Plugin pusht nicht | Token abgelaufen? Neuen Token erstellen und `git config --global credential.helper store` |
| Merge-Konflikt | In Obsidian Git: "Pull" manuell ausführen, dann Konflikt-Datei öffnen und auflösen |
| iPad Obsidian zeigt alte Version | Im iPad: Obsidian Git Plugin auch dort installieren, gleichen Token nutzen |
| Claude Projekt sieht nichts | Repo-Anbindung prüfen (Settings im Claude Projekt) und ggf. Branch auf `main` ändern |

---

## Architektur-Übersicht

```
┌─────────────┐    git push     ┌──────────────────────┐
│ PC Obsidian │────────────────▶│                      │
└─────────────┘   (alle 5min)   │   GitHub Repo        │
                                │   gold-globe/cloud/  │
┌─────────────┐    git push     │                      │
│iPad Obsidian│────────────────▶│                      │
└─────────────┘                 └──────────┬───────────┘
                                           │
                                           │ GitHub-Anbindung
                                           ▼
                                ┌──────────────────────┐
                                │   Claude Projects    │
                                │   (Web / Desktop /   │
                                │    iOS / CLI)        │
                                └──────────────────────┘
```

---

**Erstellt von**: Claude Code (Web Session)
**Repo-URL**: https://github.com/miethigmilo-art/gold-globe
**Datei-URL**: https://github.com/miethigmilo-art/gold-globe/blob/claude/setup-remote-pc-BRbm4/cloud/OBSIDIAN-CLOUD-SETUP.md
