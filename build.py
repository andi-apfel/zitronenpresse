"""Baut zwei Varianten aus src/:
- dist/zitronenpresse.html : Vorschau als Claude-Artifact (lokal, mit Beispieldaten)
- site/index.html          : Online-Version für GitHub Pages (mit Supabase-Abgleich)
"""
import json, os

ROOT = os.path.dirname(os.path.abspath(__file__))
src = lambda f: open(os.path.join(ROOT, 'src', f), encoding='utf-8').read()

shell = src('shell.html')
js = '\n'.join([src('figure.js'), src('exercises.js'), src('cards.js'), src('app.js')])
page = shell.replace('/*FIGURE*/', '').replace('/*EXERCISES*/', '').replace('/*APP*/', js)

os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
open(os.path.join(ROOT, 'dist', 'zitronenpresse.html'), 'w', encoding='utf-8').write(page)

# Online-Version: vollständiges HTML-Dokument mit Konfiguration
cfg = json.load(open(os.path.join(ROOT, 'site-config.json'), encoding='utf-8'))
head, body = page.split('<header', 1)
site = f'''<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="referrer" content="no-referrer">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" type="image/png" href="icon-180.png">
{head.strip()}
<script>window.ZP_CONFIG = {json.dumps(cfg)};</script>
</head>
<body>
<header{body}
</body>
</html>
'''
os.makedirs(os.path.join(ROOT, 'site'), exist_ok=True)
open(os.path.join(ROOT, 'site', 'index.html'), 'w', encoding='utf-8').write(site)
print('artifact', len(page), 'site', len(site))
