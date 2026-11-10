"""Build a single-file offline copy of the Retirement Simulator (the backup for the live demo).

    python3 scripts/build_offline.py        ->  dist/retirement-simulator-offline.html

Everything (styles, engine, page code, the 94 S&P 500 returns, the icon) is put inside one
HTML file, so it opens by double-clicking with no internet and no server. Same engine as the
website, so the same inputs and seed give the same numbers. Without internet the page uses
the system font instead of Manrope / Geist Mono; nothing else changes."""
import base64, re, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
html = (ROOT / "index.html").read_text()
css = (ROOT / "styles.css").read_text()
sim = (ROOT / "sim.js").read_text()
app = (ROOT / "app.js").read_text()
icon = base64.b64encode((ROOT / "favicon.svg").read_bytes()).decode()
try:
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
except OSError:
    sha = ""

def must_sub(pattern, repl, text, flags=0):
    out, n = re.subn(pattern, lambda m: repl, text, flags=flags)
    if n == 0:
        raise SystemExit(f"pattern not found: {pattern}")
    return out

# Install-as-app pieces need a web server; the offline file doesn't use them.
for pat in [r'\s*<link rel="manifest"[^>]*>', r'\s*<link rel="apple-touch-icon"[^>]*>', r'\s*<link rel="icon" href="\./favicon-32\.png"[^>]*>', r'\s*<meta name="(apple-mobile-web-app|mobile-web-app)[^>]*>']:
    html = re.sub(pat, "", html)
html = must_sub(r'<link rel="icon" href="\./favicon\.svg"[^>]*>', f'<link rel="icon" href="data:image/svg+xml;base64,{icon}">', html)
html = must_sub(r'<link rel="stylesheet" href="\./styles\.css">', f"<style>\n{css}\n.install-btn {{ display: none !important; }}\n</style>", html)
html = must_sub(r'<script src="\./sim\.js"></script>', f"<script>\n{sim}\n</script>", html)
html = must_sub(r'<script src="\./app\.js"></script>', f"<script>\n{app}\n</script>", html)
html = must_sub(r'<p class="eyebrow">', f'<p class="eyebrow">Offline copy{" · build " + sha if sha else ""} · ', html)

out = ROOT / "dist" / "retirement-simulator-offline.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html)
print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
