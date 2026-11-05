"""
Generate toy datasets for Step 3 (plan logistics) that mimic the AAA gas-price
and Booking.com hotel data used in the tour-planning hackathon project.

Outputs (in ./data):
  gas_prices.csv  - average price of regular gas per state (AAA-like)
  hotels.csv      - 6 hotels per city: rating + weekday / weekend nightly price (Booking.com-like)

Everything is synthetic. Prices are plausible but invented, so do not use them
for real budgeting. Driving distances are NOT generated here: the notebook
estimates them from coordinates (a stand-in for the Google Maps API).
Run:  python generate_logistics_data.py   (re-runs are reproducible via SEED)
"""
import numpy as np
import pandas as pd
from pathlib import Path

SEED = 7
rng = np.random.default_rng(SEED)
DATA = Path(__file__).parent / "data"

cities = pd.read_csv(DATA / "cities.csv")

# ---------------------------------------------------------------- gas prices
# rough "regular" price per gallon by state (USD); west coast highest, south/midwest lowest
BASE_GAS = {
    "CA": 4.85, "WA": 4.45, "OR": 4.15, "NV": 4.30, "AZ": 3.75, "UT": 3.60, "ID": 3.65, "CO": 3.45,
    "TX": 3.00, "LA": 3.05, "TN": 3.10, "GA": 3.20, "FL": 3.40, "NC": 3.20, "VA": 3.25, "DC": 3.60,
    "MD": 3.40, "PA": 3.65, "NY": 3.70, "MA": 3.55, "IL": 3.55, "IN": 3.35, "OH": 3.30, "MI": 3.40,
    "WI": 3.25, "MN": 3.20, "MO": 3.05,
}
states = sorted(cities.state.unique())
assert set(states) <= set(BASE_GAS), set(states) - set(BASE_GAS)
gas = pd.DataFrame({
    "state": states,
    "regular_usd_per_gal": [round(BASE_GAS[s] + rng.normal(0, 0.04), 2) for s in states],
})
gas.to_csv(DATA / "gas_prices.csv", index=False)

# ---------------------------------------------------------------- hotels
PREFIX = ["Grand", "Riverside", "Union", "Harbor", "Summit", "Maple", "Capitol", "Lakeside", "Crown", "Juniper"]
SUFFIX = ["Inn", "Suites", "Hotel", "Lodge", "Plaza", "Motel"]
PRICEY = {"New York", "San Francisco", "Boston", "Washington", "Seattle", "Los Angeles", "Miami"}

rows = []
for c in cities.itertuples():
    # bigger metros cost more; a few famously expensive cities get a bump
    base = 80 + 55 * np.log10(c.metro_population / 500_000)
    if c.city in PRICEY:
        base *= 1.25
    names = rng.choice([f"{p} {s}" for p in PREFIX for s in SUFFIX], size=6, replace=False)
    for k, name in enumerate(names):
        rating = round(float(np.clip(rng.normal(4.0, 0.5), 2.5, 4.9)), 1)   # 1-5 stars-style review score
        weekday = base * (0.65 + 0.18 * (rating - 2.5)) * rng.uniform(0.92, 1.08)
        weekend = weekday * rng.uniform(0.95, 1.25)                         # Fri/Sat nights cost a bit more
        rows.append({
            "hotel_id": f"H{c.city_id}{k}",
            "city_id": c.city_id,
            "hotel_name": f"{name}",
            "rating": rating,
            "price_weekday_usd": int(round(weekday)),
            "price_weekend_usd": int(round(weekend)),
        })
hotels = pd.DataFrame(rows)
hotels.to_csv(DATA / "hotels.csv", index=False)

print(f"gas_prices.csv: {len(gas)} states | hotels.csv: {len(hotels)} hotels in {hotels.city_id.nunique()} cities")
print(hotels.groupby("city_id").price_weekday_usd.mean().describe().round(0).to_string())
