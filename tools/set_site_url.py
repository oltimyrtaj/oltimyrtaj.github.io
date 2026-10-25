"""Put the site's real address into the files that need it, before publishing.

The canonical links, social-preview tags, sitemap and robots.txt need the full
address of the live site. They ship with the placeholder https://USERNAME.github.io.

    python tools/set_site_url.py https://yourname.github.io

Run it from the site folder. It also stamps today's date on every sitemap entry.
Running it again with a new address (for example a custom domain) works too.
"""
import datetime
import pathlib
import re
import sys

if len(sys.argv) != 2 or not sys.argv[1].startswith("https://"):
    sys.exit("usage: python tools/set_site_url.py https://yourname.github.io")
new = sys.argv[1].rstrip("/")
root = pathlib.Path(__file__).resolve().parent.parent
files = sorted(root.glob("*.html")) + [root / "sitemap.xml", root / "robots.txt"]

# whatever address is in the files now (the placeholder, or an earlier real one)
current = re.search(r'<link rel="canonical" href="(https://[^"/]+)', (root / "index.html").read_text()).group(1)
for f in files:
    text = f.read_text(encoding="utf-8").replace(current, new)
    if f.name == "sitemap.xml":
        text = re.sub(r"<lastmod>[^<]*</lastmod>", "<lastmod>%s</lastmod>" % datetime.date.today(), text)
    f.write_text(text, encoding="utf-8")
    print("updated", f.name)
