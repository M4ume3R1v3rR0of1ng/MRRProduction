import argparse
import requests
from scanner.xss import scan_xss
from scanner.sqli import scan_sqli
from scanner.reporter import print_report, save_json

def main():
    parser = argparse.ArgumentParser(
        description="Web Vulnerability Scanner — XSS & SQLi",
        epilog="⚠️  Only scan systems you own or have explicit permission to test."
    )
    parser.add_argument("url", help="Target URL (e.g. http://localhost/dvwa)")
    parser.add_argument("--xss", action="store_true", help="Run XSS scan")
    parser.add_argument("--sqli", action="store_true", help="Run SQLi scan")
    parser.add_argument("--all", action="store_true", help="Run all scans")
    parser.add_argument("--output", default="report.json", help="JSON report output path")
    args = parser.parse_args()

    run_xss = args.xss or args.all
    run_sqli = args.sqli or args.all

    if not run_xss and not run_sqli:
        print("Specify --xss, --sqli, or --all")
        return

    session = requests.Session()
    session.headers["User-Agent"] = "VulnScanner/1.0 (Educational)"

    all_findings = []
    print(f"\n[*] Target: {args.url}")

    if run_xss:
        print("[*] Running XSS scan...")
        all_findings += scan_xss(args.url, session)

    if run_sqli:
        print("[*] Running SQLi scan...")
        all_findings += scan_sqli(args.url, session)

    print_report(all_findings, args.url)
    save_json(all_findings, args.url, args.output)


if __name__ == "__main__":
    main()