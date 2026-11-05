"""
Generate toy datasets that mimic the Chartmetric / Luminate / Songkick data
used in the tour-planning hackathon project.

Outputs (in ./data):
  cities.csv            - US metros with population + coordinates
  artist.csv            - one fictional artist (and 2 comparison artists)
  city_fan_metrics.csv  - Step 1: 8 engagement metrics per artist x city
                          (Spotify listeners, YouTube city affinity, streams,
                           Instagram likers/followers, YouTube viewers,
                           product sales, song sales)
  venues.csv            - Step 2: venues in/near each metro (capacity, genres, coords)
  scheduled_events.csv  - Step 2: already-booked events per venue (Songkick-like)

Everything is synthetic. City names/coordinates/populations are approximate
real values; venue names, artists and all metrics are invented.
Run:  python generate_toy_data.py   (re-runs are reproducible via SEED)
"""
import numpy as np
import pandas as pd
from pathlib import Path

SEED = 42
rng = np.random.default_rng(SEED)
OUT = Path(__file__).parent / "data"
OUT.mkdir(exist_ok=True)

# ---------------------------------------------------------------- cities
# (city, state, lat, lon, approx metro population)
CITIES = [
    ("New York", "NY", 40.7128, -74.0060, 19_500_000),
    ("Los Angeles", "CA", 34.0522, -118.2437, 12_800_000),
    ("Chicago", "IL", 41.8781, -87.6298, 9_300_000),
    ("Dallas", "TX", 32.7767, -96.7970, 8_100_000),
    ("Houston", "TX", 29.7604, -95.3698, 7_500_000),
    ("Atlanta", "GA", 33.7490, -84.3880, 6_300_000),
    ("Washington", "DC", 38.9072, -77.0369, 6_300_000),
    ("Philadelphia", "PA", 39.9526, -75.1652, 6_200_000),
    ("Miami", "FL", 25.7617, -80.1918, 6_100_000),
    ("Phoenix", "AZ", 33.4484, -112.0740, 5_000_000),
    ("Boston", "MA", 42.3601, -71.0589, 4_900_000),
    ("San Francisco", "CA", 37.7749, -122.4194, 4_600_000),
    ("Seattle", "WA", 47.6062, -122.3321, 4_000_000),
    ("Minneapolis", "MN", 44.9778, -93.2650, 3_700_000),
    ("San Diego", "CA", 32.7157, -117.1611, 3_300_000),
    ("Tampa", "FL", 27.9506, -82.4572, 3_300_000),
    ("Denver", "CO", 39.7392, -104.9903, 3_000_000),
    ("Baltimore", "MD", 39.2904, -76.6122, 2_800_000),
    ("Orlando", "FL", 28.5383, -81.3792, 2_800_000),
    ("Charlotte", "NC", 35.2271, -80.8431, 2_800_000),
    ("San Antonio", "TX", 29.4241, -98.4936, 2_700_000),
    ("Portland", "OR", 45.5152, -122.6784, 2_500_000),
    ("Sacramento", "CA", 38.5816, -121.4944, 2_400_000),
    ("Pittsburgh", "PA", 40.4406, -79.9959, 2_400_000),
    ("Austin", "TX", 30.2672, -97.7431, 2_500_000),
    ("Las Vegas", "NV", 36.1699, -115.1398, 2_300_000),
    ("Cincinnati", "OH", 39.1031, -84.5120, 2_300_000),
    ("Kansas City", "MO", 39.0997, -94.5786, 2_200_000),
    ("Columbus", "OH", 39.9612, -82.9988, 2_200_000),
    ("Indianapolis", "IN", 39.7684, -86.1581, 2_100_000),
    ("Cleveland", "OH", 41.4993, -81.6944, 2_100_000),
    ("Nashville", "TN", 36.1627, -86.7816, 2_000_000),
    ("Salt Lake City", "UT", 40.7608, -111.8910, 1_300_000),
    ("Raleigh", "NC", 35.7796, -78.6382, 1_500_000),
    ("New Orleans", "LA", 29.9511, -90.0715, 1_300_000),
    ("Detroit", "MI", 42.3314, -83.0458, 4_300_000),
    ("St. Louis", "MO", 38.6270, -90.1994, 2_800_000),
    ("Milwaukee", "WI", 43.0389, -87.9065, 1_600_000),
    ("Richmond", "VA", 37.5407, -77.4360, 1_300_000),
    ("Boise", "ID", 43.6150, -116.2023, 800_000),
]
cities = pd.DataFrame(CITIES, columns=["city", "state", "lat", "lon", "metro_population"])
cities.insert(0, "city_id", [f"C{i:03d}" for i in range(1, len(cities) + 1)])
cities.to_csv(OUT / "cities.csv", index=False)

# ---------------------------------------------------------------- artists
artists = pd.DataFrame([
    # artist_id, name, genre, career_stage, total_monthly_listeners (US)
    ("A001", "Nova Reyes", "indie pop", "mid-level", 4_200_000),
    ("A002", "The Copper Pines", "folk rock", "emerging", 900_000),
    ("A003", "Kairo Blaze", "hip hop", "established", 11_000_000),
], columns=["artist_id", "artist_name", "primary_genre", "career_stage", "us_monthly_listeners"])
artists.to_csv(OUT / "artist.csv", index=False)

# Genre "lift" by city -> creates realistic geographic variation in fandom
GENRE_HOT = {
    "indie pop": {"Portland", "Seattle", "Austin", "Denver", "Minneapolis", "San Francisco",
                  "Los Angeles", "Chicago", "Boston", "Nashville", "Salt Lake City"},
    "folk rock": {"Nashville", "Denver", "Portland", "Boise", "Minneapolis", "Austin",
                  "Raleigh", "Richmond", "Salt Lake City", "Seattle"},
    "hip hop":   {"Atlanta", "Houston", "New York", "Los Angeles", "Chicago", "Detroit",
                  "Miami", "Philadelphia", "Washington", "New Orleans", "Baltimore"},
}

rows = []
total_pop = cities.metro_population.sum()
for _, a in artists.iterrows():
    hot = GENRE_HOT[a.primary_genre]
    for _, c in cities.iterrows():
        # latent per-capita affinity: genre lift x random city taste
        affinity = (1.9 if c.city in hot else 1.0) * rng.lognormal(0, 0.35)
        share = c.metro_population / total_pop
        listeners = a.us_monthly_listeners * share * affinity * rng.normal(1, 0.05)

        def noisy(base, sd=0.12):
            return max(0, base * rng.normal(1, sd))

        rows.append({
            "artist_id": a.artist_id,
            "city_id": c.city_id,
            "city": c.city,
            "state": c.state,
            # ---- Passive engagement (Chartmetric/Luminate-like)
            "spotify_monthly_listeners": round(listeners),
            "youtube_city_affinity": round(min(1, 0.35 * affinity * rng.normal(1, 0.1)), 3),  # 0-1 index
            "streams_28d": round(noisy(listeners * 9.5)),  # on-demand audio+video streams
            # ---- Proactive engagement
            "instagram_likers": round(noisy(listeners * 0.06 * affinity ** 0.5)),
            "instagram_followers": round(noisy(listeners * 0.11)),
            "youtube_viewers_28d": round(noisy(listeners * 0.45)),
            "product_sales_units": round(noisy(listeners * 0.004 * affinity, 0.25)),  # albums/vinyl/merch
            "song_sales_units": round(noisy(listeners * 0.006, 0.2)),  # digital track downloads
        })
metrics = pd.DataFrame(rows)
metrics.to_csv(OUT / "city_fan_metrics.csv", index=False)

# ---------------------------------------------------------------- venues
# Capacity tiers: club / theater / hall / amphitheater / arena
TIERS = [
    ("club", 250, 900),
    ("theater", 1_000, 3_000),
    ("music hall", 2_500, 5_500),
    ("amphitheater", 6_000, 20_000),
    ("arena", 12_000, 20_000),
]
GENRE_POOL = ["indie pop", "folk rock", "hip hop", "rock", "electronic", "country", "jazz", "r&b", "metal"]
NAME_A = ["Blue", "Echo", "Granite", "Velvet", "Lantern", "Harbor", "Juniper", "Neon", "Union",
          "Copper", "Riverside", "Northside", "Golden", "Ironworks", "Magnolia", "Summit"]
NAME_B = {"club": ["Room", "Lounge", "Social Club", "Basement"],
          "theater": ["Theater", "Playhouse", "Ballroom"],
          "music hall": ["Music Hall", "Auditorium", "Pavilion Hall"],
          "amphitheater": ["Amphitheater", "Lawn", "Bowl"],
          "arena": ["Arena", "Center", "Coliseum"]}

venue_rows, vid = [], 1
for _, c in cities.iterrows():
    n = int(np.clip(round(c.metro_population / 1_200_000) + 5, 5, 14))
    for _ in range(n):
        # bigger metros get more large venues
        p = np.array([0.38, 0.27, 0.17, 0.10, 0.08]) if c.metro_population > 4e6 else \
            np.array([0.45, 0.30, 0.15, 0.07, 0.03])
        t, lo, hi = TIERS[rng.choice(len(TIERS), p=p)]
        in_city = rng.random() < 0.7
        dist_km = rng.uniform(0, 8) if in_city else rng.uniform(10, 60)  # suburbs / nearby towns
        ang = rng.uniform(0, 2 * np.pi)
        lat = c.lat + (dist_km / 111) * np.sin(ang)
        lon = c.lon + (dist_km / (111 * np.cos(np.radians(c.lat)))) * np.cos(ang)
        genres = list(rng.choice(GENRE_POOL, size=rng.integers(2, 5), replace=False))
        # venues lean toward the genres that are popular locally
        for g, hot_cities in GENRE_HOT.items():
            if c.city in hot_cities and g not in genres and rng.random() < 0.5:
                genres.append(g)
        venue_rows.append({
            "venue_id": f"V{vid:04d}",
            "venue_name": f"{rng.choice(NAME_A)} {rng.choice(NAME_B[t])}",
            "venue_type": t,
            "capacity": int(round(rng.integers(lo, hi) / 50) * 50),
            "genres_booked": "|".join(genres),
            "metro_city_id": c.city_id,
            "locality": c.city if in_city else f"{c.city} suburbs",
            "state": c.state,
            "season": "May-Oct" if t == "amphitheater" else "year-round",
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "avg_ticket_price_usd": int(rng.normal({"club": 30, "theater": 55, "music hall": 70,
                                                     "amphitheater": 85, "arena": 110}[t], 10)),
        })
        vid += 1
venues = pd.DataFrame(venue_rows)
venues.to_csv(OUT / "venues.csv", index=False)

# ---------------------------------------------------------------- scheduled events
# Songkick-like calendar of already-booked shows during the planning window.
WINDOW = pd.date_range("2027-03-01", "2027-06-30", freq="D")
FAKE_ACTS = [f"{a} {b}" for a in ["Midnight", "Silver", "Wild", "Paper", "Static", "Sunday",
                                  "Hollow", "Atlas", "Lucky", "Glass"]
             for b in ["Hearts", "Tides", "Engines", "Foxes", "Kids", "Choir", "Signal", "Avenue"]]
ev_rows, eid = [], 1
for _, v in venues.iterrows():
    # weekends book up faster; bigger rooms book less often
    occupancy = {"club": 0.55, "theater": 0.45, "music hall": 0.40,
                 "amphitheater": 0.25, "arena": 0.35}[v.venue_type] * rng.uniform(0.7, 1.3)
    if v.venue_type == "amphitheater":
        days = WINDOW[WINDOW.month >= 5]  # outdoor season starts in May
    else:
        days = WINDOW
    for d in days:
        p = occupancy * (1.5 if d.dayofweek >= 4 else 0.8)
        if rng.random() < min(p, 0.95):
            ev_rows.append({
                "event_id": f"E{eid:06d}",
                "venue_id": v.venue_id,
                "event_date": d.date().isoformat(),
                "performer": rng.choice(FAKE_ACTS),
                "event_genre": rng.choice(v.genres_booked.split("|")),
                "status": "ok",
            })
            eid += 1
events = pd.DataFrame(ev_rows)
events.to_csv(OUT / "scheduled_events.csv", index=False)

print(f"cities: {len(cities)} | artists: {len(artists)} | metrics rows: {len(metrics)} | "
      f"venues: {len(venues)} | events: {len(events)}")
