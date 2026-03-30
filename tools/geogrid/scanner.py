import time
import requests


API_URL = "https://places.googleapis.com/v1/places:searchNearby"

FIELD_MASK = "places.id,places.displayName,places.formattedAddress"


def search_nearby(api_key, lat, lng, keyword, radius_m):
    """Appelle Google Places API (New) searchNearby pour un point."""
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": FIELD_MASK,
    }
    body = {
        "textQuery": keyword,
        "locationBias": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": radius_m,
            }
        },
        "maxResultCount": 20,
    }
    # searchNearby ne supporte pas textQuery — on utilise searchText a la place
    # qui permet de combiner keyword + localisation
    url = "https://places.googleapis.com/v1/places:searchText"

    resp = requests.post(url, json=body, headers=headers, timeout=10)
    resp.raise_for_status()
    return resp.json().get("places", [])


def find_rank(places, business_name, place_id):
    """Trouve le rang de l'etablissement dans les resultats."""
    business_lower = business_name.lower().strip()

    for i, place in enumerate(places):
        # Match par place_id (prioritaire)
        if place_id and place.get("id", "") == place_id:
            return i + 1

        # Match par nom (partiel, insensible a la casse)
        display = place.get("displayName", {}).get("text", "").lower()
        if business_lower and business_lower in display:
            return i + 1

    return None


def scan_grid(config, grid_points):
    """Scanne tous les points de la grille. Retourne les resultats enrichis."""
    api_key = config["api_key"]
    keyword = config["keyword"]
    business_name = config["business_name"]
    place_id = config["place_id"]
    search_radius = config["search_radius_m"]
    total = len(grid_points)

    results = []
    for idx, point in enumerate(grid_points):
        label = f"[{idx + 1}/{total}]"
        lat, lng = point["lat"], point["lng"]

        try:
            places = search_nearby(api_key, lat, lng, keyword, search_radius)
            rank = find_rank(places, business_name, place_id)
            status = "ok"
        except requests.exceptions.RequestException as e:
            # Retry 1x
            try:
                time.sleep(1)
                places = search_nearby(api_key, lat, lng, keyword, search_radius)
                rank = find_rank(places, business_name, place_id)
                status = "ok (retry)"
            except Exception:
                rank = None
                status = f"error: {e}"

        rank_display = f"#{rank}" if rank else "absent"
        print(f"  {label} ({lat}, {lng}) -> {rank_display}")

        results.append({
            **point,
            "rank": rank,
            "status": status,
            "total_results": len(places) if status.startswith("ok") else 0,
        })

        # Rate limiting — 200ms entre chaque appel
        if idx < total - 1:
            time.sleep(0.2)

    return results
