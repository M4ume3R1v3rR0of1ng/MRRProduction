import json
from datetime import datetime

def print_report(findings: list[dict], target: str) -> None:
    print("\n" + "="*60)
    print(f"  SCAN REPORT — {target}")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*60)

    if not findings:
        print("  ✓ No vulnerabilities detected.\n")
        return

    xss = [f for f in findings if f["type"] == "XSS"]
    sqli = [f for f in findings if f["type"] == "SQLi"]

    if xss:
        print(f"\n  [XSS] {len(xss)} finding(s):")
        for f in xss:
            print(f"    → {f['form_action']} [{f['method'].upper()}]")
            print(f"      Payload: {f['payload']}")

    if sqli:
        print(f"\n  [SQLi] {len(sqli)} finding(s):")
        for f in sqli:
            print(f"    → {f['form_action']} [{f['method'].upper()}]")
            print(f"      Payload: {f['payload']}")
            print(f"      DB error matched: {f['db_error']}")

    print()


def save_json(findings: list[dict], target: str, output_file: str = "report.json") -> None:
    report = {
        "target": target,
        "timestamp": datetime.now().isoformat(),
        "total_findings": len(findings),
        "findings": findings,
    }
    with open(output_file, "w") as f:
        json.dump(report, f, indent=2)
    print(f"  [+] JSON report saved to {output_file}")