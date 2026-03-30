import json
import os
from jinja2 import Environment, FileSystemLoader


TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")


def generate_report(config, results, timestamp, output_path):
    """Genere un rapport HTML avec carte Leaflet."""
    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR))
    template = env.get_template("report.html")

    html = template.render(
        results_json=json.dumps(results),
        center_lat=config["center_lat"],
        center_lng=config["center_lng"],
        business_name=config["business_name"],
        keyword=config["keyword"],
        timestamp=timestamp,
    )

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)

    return output_path
