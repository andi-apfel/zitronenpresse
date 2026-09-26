# Zitronenpresse

Gemeinsame Trainings-App für Hanne (Po & Beine) und Andi (Oberkörper): täglich 15 Minuten zu Hause,
Strichliste, Wochen-Duell mit Sonntags-Belohnung um 20 Uhr und freischaltbare Erfolge.

- **App:** `index.html` (wird von GitHub Pages ausgeliefert, aufs iPhone per „Teilen → Zum Home-Bildschirm“)
- **Quellcode:** `src/` (`app.js` Logik, `exercises.js` Übungen, `cards.js` Belohnungskarten, `figure.js` Strichfiguren, `shell.html` Layout)
- **Bauen:** `python3 build.py` erzeugt `site/index.html`; danach nach `index.html` kopieren.
- **Daten:** Supabase (nur Funktionen `zp_pull`/`zp_push`, Tabelle für Fremdzugriff gesperrt).
  Zugriff nur mit dem geheimen Paar-Code, der auf den Geräten gespeichert ist und nicht im Code steht.
  `site-config.json` enthält nur die öffentliche Projekt-URL und den Publishable Key.
