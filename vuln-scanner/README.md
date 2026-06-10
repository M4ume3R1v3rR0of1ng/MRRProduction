# Web Vulnerability Scanner

A Python-based CLI tool for detecting **Reflected XSS** and **Error/Time-based SQL Injection**
in web applications by crawling forms and injecting test payloads.

> ⚠️ **Legal Disclaimer**: This tool is for educational purposes only.
> Only run against systems you own or have **explicit written permission** to test.
> Unauthorized use may violate the CFAA, Computer Misuse Act, or local equivalents.

---

## Features

- Crawls all HTML forms on a target page
- Tests for reflected XSS via payload injection + response matching
- Tests for SQLi via error signature detection and time-based blind detection
- JSON report output
- Easily extensible payload lists (no code changes needed)

## Installation

```bash
git clone https://github.com/yourname/vuln-scanner
cd vuln-scanner
pip install -r requirements.txt
```

## Usage

```bash
# Scan for both vulnerabilities
python main.py http://localhost/dvwa --all

# XSS only
python main.py http://localhost/dvwa --xss

# SQLi only, custom report path
python main.py http://localhost/dvwa --sqli --output results.json
```

## Safe Testing Environments

Never test against real targets. Use these intentionally vulnerable apps:

| App | Docker command |
|-----|---------------|
| DVWA | `docker run -p 80:80 vulnerables/web-dvwa` |
| bWAPP | `docker run -p 80:80 raesene/bwapp` |
| WebGoat | `docker run -p 8080:8080 webgoat/webgoat` |

## How It Works

**XSS**: Injects payloads into form fields and checks if they appear
unescaped in the response body — indicating the server echoes input
without sanitization.

**SQLi**: Injects characters that break SQL syntax (`'`, `"`) and
boolean/time-based payloads, then checks the response for database
error strings or abnormal response delays.

## Limitations

- XSS: detects reflected only — not stored or DOM-based
- SQLi: covers error-based and time-based blind — not second-order
- No WAF bypass techniques
- Single-page scan (no recursive crawling — yet)

## Roadmap

- [ ] Recursive site crawling with scope control
- [ ] DOM XSS detection via Selenium
- [ ] Header/cookie injection points
- [ ] CVSS severity scoring per finding
- [ ] Async scanning for speed# Web Vulnerability Scanner

A Python-based CLI tool for detecting **Reflected XSS** and **Error/Time-based SQL Injection**
in web applications by crawling forms and injecting test payloads.

> ⚠️ **Legal Disclaimer**: This tool is for educational purposes only.
> Only run against systems you own or have **explicit written permission** to test.
> Unauthorized use may violate the CFAA, Computer Misuse Act, or local equivalents.

---

## Features

- Crawls all HTML forms on a target page
- Tests for reflected XSS via payload injection + response matching
- Tests for SQLi via error signature detection and time-based blind detection
- JSON report output
- Easily extensible payload lists (no code changes needed)

## Installation

```bash
git clone https://github.com/yourname/vuln-scanner
cd vuln-scanner
pip install -r requirements.txt
```

## Usage

```bash
# Scan for both vulnerabilities
python main.py http://localhost/dvwa --all

# XSS only
python main.py http://localhost/dvwa --xss

# SQLi only, custom report path
python main.py http://localhost/dvwa --sqli --output results.json
```

## Safe Testing Environments

Never test against real targets. Use these intentionally vulnerable apps:

| App | Docker command |
|-----|---------------|
| DVWA | `docker run -p 80:80 vulnerables/web-dvwa` |
| bWAPP | `docker run -p 80:80 raesene/bwapp` |
| WebGoat | `docker run -p 8080:8080 webgoat/webgoat` |

## How It Works

**XSS**: Injects payloads into form fields and checks if they appear
unescaped in the response body — indicating the server echoes input
without sanitization.

**SQLi**: Injects characters that break SQL syntax (`'`, `"`) and
boolean/time-based payloads, then checks the response for database
error strings or abnormal response delays.

## Limitations

- XSS: detects reflected only — not stored or DOM-based
- SQLi: covers error-based and time-based blind — not second-order
- No WAF bypass techniques
- Single-page scan (no recursive crawling — yet)

## Roadmap

- [ ] Recursive site crawling with scope control
- [ ] DOM XSS detection via Selenium
- [ ] Header/cookie injection points
- [ ] CVSS severity scoring per finding
- [ ] Async scanning for speed