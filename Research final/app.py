"""
Wattpad (Sinhala) story -> PDF
Paste a Wattpad story or chapter link, the app fetches the chapters,
checks that the text is Sinhala, and gives you a PDF.

Run:  python app.py   then open http://127.0.0.1:5000
"""
import io
import re
import html
import requests
from bs4 import BeautifulSoup
from flask import Flask, request, send_file, render_template_string
from playwright.sync_api import sync_playwright

app = Flask(__name__)

HEADERS = {"User-Agent": "Mozilla/5.0 (personal offline-reading tool)"}
SINHALA_RE = re.compile(r"[\u0D80-\u0DFF]")
LETTER_RE = re.compile(r"[^\W\d_]", re.UNICODE)
MIN_SINHALA_RATIO = 0.30  # at least 30% of letters must be Sinhala


# ---------- Sinhala detection ----------
def sinhala_ratio(text: str) -> float:
    letters = LETTER_RE.findall(text)
    if not letters:
        return 0.0
    return len(SINHALA_RE.findall(text)) / len(letters)


# ---------- Wattpad fetching ----------
def get_story_id(url: str) -> str:
    """Accepts a story URL (/story/123-title) or chapter URL (/987654-title)."""
    m = re.search(r"wattpad\.com/story/(\d+)", url)
    if m:
        return m.group(1)
    m = re.search(r"wattpad\.com/(\d+)", url)
    if m:  # chapter link -> find the parent story
        part_id = m.group(1)
        r = requests.get(
            f"https://www.wattpad.com/api/v3/story_parts/{part_id}?fields=groupId",
            headers=HEADERS, timeout=30)
        r.raise_for_status()
        return str(r.json()["groupId"])
    raise ValueError("That does not look like a Wattpad story or chapter link.")


def get_story(story_id: str) -> dict:
    r = requests.get(
        f"https://www.wattpad.com/api/v3/stories/{story_id}"
        "?fields=title,user(name),description,parts(id,title)",
        headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def get_chapter_html(part_id) -> str:
    r = requests.get(
        f"https://www.wattpad.com/apiv2/storytext?id={part_id}",
        headers=HEADERS, timeout=60)
    r.raise_for_status()
    return r.text


def clean_chapter(raw_html: str) -> tuple[str, str]:
    """Return (safe_html, plain_text). Keeps only paragraphs/basic formatting."""
    soup = BeautifulSoup(raw_html, "html.parser")
    for tag in soup(["script", "style", "img", "iframe"]):
        tag.decompose()
    paragraphs = []
    for p in soup.find_all("p"):
        txt = p.get_text(" ", strip=True)
        if txt:
            paragraphs.append(f"<p>{html.escape(txt)}</p>")
    if not paragraphs:  # fallback: no <p> tags
        txt = soup.get_text("\n", strip=True)
        paragraphs = [f"<p>{html.escape(l)}</p>" for l in txt.split("\n") if l.strip()]
    plain = soup.get_text(" ", strip=True)
    return "\n".join(paragraphs), plain


# ---------- PDF building ----------
CSS = """
body { font-family: 'Nirmala UI', 'Iskoola Pota', 'Noto Sans Sinhala', sans-serif;
       font-size: 12pt; line-height: 1.7; }
h1 { text-align: center; font-size: 24pt; margin-top: 40mm; }
h2 { font-size: 16pt; page-break-before: always; border-bottom: 1px solid #999; padding-bottom: 4px; }
.author { text-align: center; color: #555; }
p { margin: 0 0 8pt 0; text-align: justify; }
"""


def build_pdf(title, author, chapters) -> bytes:
    body = [f"<h1>{html.escape(title)}</h1><p class='author'>{html.escape(author)}</p>"]
    for ch_title, ch_html in chapters:
        body.append(f"<h2>{html.escape(ch_title)}</h2>{ch_html}")
    doc = f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{''.join(body)}</body></html>"
    with sync_playwright() as p:
        try:  # use the Edge already installed on Windows (no download needed)
            browser = p.chromium.launch(channel="msedge")
        except Exception:  # fall back to Chrome
            browser = p.chromium.launch(channel="chrome")
        page = browser.new_page()
        page.set_content(doc, wait_until="load")
        pdf = page.pdf(
            format="A5", print_background=True,
            margin={"top": "18mm", "bottom": "18mm", "left": "14mm", "right": "14mm"},
            display_header_footer=True, header_template="<span></span>",
            footer_template='<div style="font-size:9px;width:100%;text-align:center;"><span class="pageNumber"></span></div>')
        browser.close()
    return pdf


# ---------- Web UI ----------
PAGE = """
<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wattpad Sinhala → PDF</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px}
 input{width:100%;padding:12px;font-size:16px;box-sizing:border-box}
 button{margin-top:12px;padding:12px 20px;font-size:16px;cursor:pointer}
 .err{background:#fde8e8;padding:10px;border-radius:6px;margin-top:12px}
</style>
<h2>Wattpad Sinhala story → PDF</h2>
<form method="post" onsubmit="document.getElementById('b').textContent='Working… please wait'">
  <input name="url" placeholder="Paste Wattpad story or chapter link" required>
  <button id="b">Download PDF</button>
</form>
{% if error %}<div class="err">{{ error }}</div>{% endif %}
"""


@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "GET":
        return render_template_string(PAGE)
    try:
        story_id = get_story_id(request.form["url"].strip())
        story = get_story(story_id)
        chapters, all_plain = [], []
        for part in story.get("parts", []):
            ch_html, plain = clean_chapter(get_chapter_html(part["id"]))
            chapters.append((part["title"], ch_html))
            all_plain.append(plain)

        ratio = sinhala_ratio(" ".join(all_plain))
        if ratio < MIN_SINHALA_RATIO:
            return render_template_string(
                PAGE, error=f"This story doesn't look Sinhala "
                            f"(only {ratio:.0%} Sinhala text), so no PDF was made.")

        pdf = build_pdf(story["title"], story["user"]["name"], chapters)
        fname = re.sub(r"[^\w\-]+", "_", story["title"], flags=re.UNICODE) or "story"
        return send_file(io.BytesIO(pdf), mimetype="application/pdf",
                         as_attachment=True, download_name=f"{fname}.pdf")
    except Exception as e:
        return render_template_string(PAGE, error=f"Error: {e}")


if __name__ == "__main__":
    app.run(debug=True)