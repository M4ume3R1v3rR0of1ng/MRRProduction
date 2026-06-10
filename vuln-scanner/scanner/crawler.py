import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

def get_forms(url: str, session: requests.Session) -> list[dict]:
    """Scrape all forms from a URL and return structured form data."""
    try:
        response = session.get(url, timeout=10)
        soup = BeautifulSoup(response.content, "html.parser")
    except requests.RequestException as e:
        print(f"[ERROR] Could not reach {url}: {e}")
        return []

    forms = []
    for form in soup.find_all("form"):
        form_data = {
            "action": urljoin(url, form.attrs.get("action", "")),
            "method": form.attrs.get("method", "get").lower(),
            "inputs": []
        }
        for input_tag in form.find_all(["input", "textarea", "select"]):
            input_type = input_tag.attrs.get("type", "text")
            input_name = input_tag.attrs.get("name")
            input_value = input_tag.attrs.get("value", "test")
            if input_name:
                form_data["inputs"].append({
                    "type": input_type,
                    "name": input_name,
                    "value": input_value
                })
        forms.append(form_data)

    return forms


def submit_form(form: dict, payload: str, session: requests.Session) -> requests.Response | None:
    """Submit a form with a given payload injected into all text inputs."""
    data = {}
    for input_field in form["inputs"]:
        if input_field["type"] in ("text", "search", "email", "password", "textarea"):
            data[input_field["name"]] = payload
        else:
            data[input_field["name"]] = input_field["value"]

    try:
        if form["method"] == "post":
            return session.post(form["action"], data=data, timeout=10)
        else:
            return session.get(form["action"], params=data, timeout=10)
    except requests.RequestException as e:
        print(f"[ERROR] Form submission failed: {e}")
        return None