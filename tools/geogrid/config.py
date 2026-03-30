import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))


def get_config():
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key or api_key == "your_api_key_here":
        raise ValueError(
            "GOOGLE_API_KEY manquante. Copie .env.example -> .env et remplis ta cle API."
        )

    return {
        "api_key": api_key,
        "business_name": os.getenv("BUSINESS_NAME", ""),
        "place_id": os.getenv("PLACE_ID", ""),
        "keyword": os.getenv("KEYWORD", ""),
        "center_lat": float(os.getenv("CENTER_LAT", "0")),
        "center_lng": float(os.getenv("CENTER_LNG", "0")),
        "radius_km": float(os.getenv("RADIUS_KM", "5")),
        "grid_size": int(os.getenv("GRID_SIZE", "7")),
        "search_radius_m": int(os.getenv("SEARCH_RADIUS_M", "1000")),
    }
