import math


def generate_grid(center_lat, center_lng, radius_km, grid_size):
    """
    Genere une grille NxN de points GPS centres sur (center_lat, center_lng).
    Approximation lineaire — precise a <0.5% pour rayon < 20km.
    """
    # Conversion km -> degres
    km_per_deg_lat = 111.32
    km_per_deg_lng = 111.32 * math.cos(math.radians(center_lat))

    delta_lat = radius_km / km_per_deg_lat
    delta_lng = radius_km / km_per_deg_lng

    # Bornes de la grille
    lat_min = center_lat - delta_lat
    lat_max = center_lat + delta_lat
    lng_min = center_lng - delta_lng
    lng_max = center_lng + delta_lng

    # Pas entre chaque point
    steps = grid_size - 1 if grid_size > 1 else 1
    lat_step = (lat_max - lat_min) / steps
    lng_step = (lng_max - lng_min) / steps

    points = []
    for row in range(grid_size):
        for col in range(grid_size):
            lat = lat_max - row * lat_step  # Nord -> Sud
            lng = lng_min + col * lng_step  # Ouest -> Est
            points.append({
                "row": row,
                "col": col,
                "lat": round(lat, 6),
                "lng": round(lng, 6),
            })

    return points
