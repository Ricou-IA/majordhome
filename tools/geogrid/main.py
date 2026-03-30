#!/usr/bin/env python3
"""
GeoGrid Rank Tracker
Scanne le classement d'un etablissement sur Google Maps
a travers une grille de points geographiques.
"""

import json
import os
import sys
import argparse
from datetime import datetime

from config import get_config
from grid import generate_grid
from scanner import scan_grid
from report import generate_report


OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")


def main():
    parser = argparse.ArgumentParser(description="GeoGrid Rank Tracker")
    parser.add_argument("--keyword", help="Override le mot-cle de recherche")
    parser.add_argument("--radius", type=float, help="Override le rayon en km")
    parser.add_argument("--grid", type=int, help="Override la taille de grille (NxN)")
    parser.add_argument("--dry-run", action="store_true", help="Affiche la grille sans scanner")
    args = parser.parse_args()

    # 1. Config
    try:
        config = get_config()
    except ValueError as e:
        print(f"Erreur config: {e}")
        sys.exit(1)

    if args.keyword:
        config["keyword"] = args.keyword
    if args.radius:
        config["radius_km"] = args.radius
    if args.grid:
        config["grid_size"] = args.grid

    grid_size = config["grid_size"]
    total_points = grid_size * grid_size

    print(f"\n{'='*50}")
    print(f"  GeoGrid Rank Tracker")
    print(f"{'='*50}")
    print(f"  Etablissement : {config['business_name']}")
    print(f"  Keyword       : {config['keyword']}")
    print(f"  Centre        : {config['center_lat']}, {config['center_lng']}")
    print(f"  Rayon         : {config['radius_km']} km")
    print(f"  Grille        : {grid_size}x{grid_size} ({total_points} points)")
    print(f"{'='*50}\n")

    # 2. Grille
    print("Generation de la grille...")
    grid_points = generate_grid(
        config["center_lat"],
        config["center_lng"],
        config["radius_km"],
        config["grid_size"],
    )
    print(f"  {len(grid_points)} points generes.\n")

    if args.dry_run:
        print("Mode dry-run — grille generee:")
        for p in grid_points:
            print(f"  [{p['row']},{p['col']}] ({p['lat']}, {p['lng']})")
        sys.exit(0)

    # 3. Scan
    print(f"Scan en cours ({total_points} points, ~{total_points * 0.3:.0f}s)...\n")
    results = scan_grid(config, grid_points)

    # Stats
    found = [r for r in results if r["rank"] is not None]
    top3 = [r for r in found if r["rank"] <= 3]
    top10 = [r for r in found if r["rank"] <= 10]

    print(f"\n{'='*50}")
    print(f"  Resultats")
    print(f"{'='*50}")
    print(f"  Top 3   : {len(top3)}/{total_points}")
    print(f"  Top 10  : {len(top10)}/{total_points}")
    print(f"  Trouve  : {len(found)}/{total_points}")
    print(f"  Absent  : {total_points - len(found)}/{total_points}")
    print(f"{'='*50}\n")

    # 4. Sauvegarde
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%Hh%M")

    # JSON
    json_path = os.path.join(OUTPUT_DIR, f"scan_{timestamp}.json")
    scan_data = {
        "timestamp": timestamp,
        "config": {
            "business_name": config["business_name"],
            "keyword": config["keyword"],
            "center": [config["center_lat"], config["center_lng"]],
            "radius_km": config["radius_km"],
            "grid_size": config["grid_size"],
        },
        "results": results,
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(scan_data, f, ensure_ascii=False, indent=2)
    print(f"  JSON : {json_path}")

    # HTML
    html_path = os.path.join(OUTPUT_DIR, f"scan_{timestamp}.html")
    generate_report(config, results, timestamp, html_path)
    print(f"  HTML : {html_path}")

    print(f"\nOuvre {html_path} dans ton navigateur pour voir la carte.")


if __name__ == "__main__":
    main()
