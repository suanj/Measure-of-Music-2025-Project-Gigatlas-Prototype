# Methodology: City Index and Venue Selection

This document explains the reasoning behind `Create Index.ipynb`:

- **Step 1 (§1–5):** how `build_composite_index()` turns an artist's raw fan-engagement metrics, measured
  per city, into a single ranked `city_index` score used to pick tour cities.
- **Step 2 (§6–7):** how each top city's expected demand is estimated and its best venue is chosen.

`tour_planner.py` is a simpler version that uses different weights and also filters on genre. The README
lists the differences. Everything here describes the notebook.

## 1. The problem

For a given artist, we have 8 engagement metrics per city (Spotify listeners, YouTube affinity,
streams, Instagram likes/follows, YouTube viewers, product sales, song sales). The goal: combine
these into one number per city that reflects how good a tour market that city is, then rank cities
by it.

Two things make this harder than "just add the numbers up":

- The metrics are on wildly different scales (raw counts in the hundreds of thousands vs. an
  affinity index already bounded 0–1).
- Raw counts are dominated by city size — New York will always have more listeners than Boise
  simply because it has far more people, regardless of how much either city actually loves the
  artist.

## 2. Two signal types: Passive vs. Proactive

Metrics are split into two groups:

| Group | Metrics | Why |
|---|---|---|
| **Passive** | `spotify_monthly_listeners`, `youtube_city_affinity`, `streams_28d` | Listening — a weak, noisy proxy for purchase intent |
| **Proactive** | `instagram_likers`, `instagram_followers`, `youtube_viewers_28d`, `product_sales_units`, `song_sales_units` | Following, buying — a stronger behavioral signal that someone will show up and pay for a ticket |

Proactive engagement is weighted higher overall (`factor_weights`: Passive **0.35** / Proactive
**0.65**), because the decision to follow an artist or buy merch predicts ticket-buying behavior
better than passively having a song on in the background.

## 3. Scaling each metric: volume + per-capita, blended

For the 7 **count-based** metrics (everything except `youtube_city_affinity`, which is already an
affinity index — see the end of this section), each metric is turned into a `_score` through two
independent branches that are blended together:

```
raw value
   ├─► log1p(raw)                 ─► min-max scaled ─► vol_scaled
   └─► raw ÷ metro_population     ─► min-max scaled ─► percap_scaled

metric_score = 0.5 × vol_scaled + 0.5 × percap_scaled
```

### Why log-scaled volume, not raw counts

City-level counts are heavily right-skewed — a handful of mega-metros can have 20×+ more raw
volume than a typical city. Feeding raw counts into min-max scaling would make the score almost
entirely "is this one of the 3 biggest US metros," which adds no information we don't already have
from population alone.

`log1p` compresses that skew: it converts multiplicative differences (New York has ~20× Boise's raw
listeners) into additive ones (New York's log-volume is only ~3 points higher). This also reflects
a real economic intuition — diminishing returns. The difference between 100K and 200K listeners
(a doubling) should count similarly to the difference between 1M and 2M listeners (also a
doubling) — not get swamped by the raw gap in absolute terms. Venue capacity, press attention, and
ticket demand all saturate; they don't scale linearly with raw audience size forever.

### Why per-capita, specifically

Per-capita is a market-penetration rate: *out of everyone who could be a fan in this city, what
fraction actually is?* Population is the natural denominator because it's the addressable
market — the pool of people the artist could reach in that metro.

Per-capita alone would be unreliable (a tiny town with a few enthusiastic fans can post a
misleadingly high rate — you can't sell out a venue with 10 people), and volume alone would just
reproduce the city-population ranking every time. Blending both means a city has to be **both**
large enough to matter **and** disproportionately engaged to score well — neither extreme wins
alone.

**Worked example** (Nova Reyes — indie pop):

| City | Listeners | Population | Per-capita | Log-volume |
|---|---|---|---|---|
| Boise | 26,621 | 800,000 | 3.33% | 10.19 |
| Portland | 234,192 | 2,500,000 | **9.37%** | 12.36 |
| New York | 523,829 | 19,500,000 | 2.69% | **13.17** |

Raw counts alone would put Portland well behind Chicago (610,530), New York and Los Angeles.
Per-capita flips it — Portland has by far the deepest fan penetration, which is exactly the signal
the index is built to surface (this dataset is deliberately constructed so indie pop is "hot" in
Portland).

### Why min-max scaling, and why per artist

Every metric lands on a different numeric scale (log-volume ≈ 10–13, per-capita ≈ 0–0.1). Min-max
rescales each one to its own 0–1 range (lowest city → 0, highest → 1) **within one artist's set of
cities**, so that:

1. All metrics become directly comparable and safe to average or weight together.
2. The comparison stays "where is *this artist* relatively strong," not "which artist is
   popular" — scaling globally across artists would mix fundamentally different audience sizes
   (Kairo Blaze's 11M listeners vs. The Copper Pines' 900K) and distort the per-artist ranking.

### The one exception: `youtube_city_affinity`

This metric isn't a raw count — it's already a relative affinity index (already roughly 0–1,
describing how disproportionately a city cares, not a headcount). Dividing an already-relative
score by population a second time wouldn't mean anything, so it skips the log/per-capita branch
entirely and goes straight to a plain per-artist min-max.

## 4. Weighting within each factor

Once every metric has one `_score` value (0–1), each factor's score is a weighted sum of its
metrics — not a plain average, because not every metric is considered equally predictive of ticket
sales:

```python
variable_weights = {
    'Passive Engagement': {
        'spotify_monthly_listeners_score': 0.45,
        'youtube_city_affinity_score': 0.25,
        'streams_28d_score': 0.30
    },
    'Proactive Engagement': {
        'instagram_likers_score': 0.10,
        'instagram_followers_score': 0.20,
        'youtube_viewers_28d_score': 0.15,
        'product_sales_units_score': 0.35,
        'song_sales_units_score': 0.20
    }
}
```

`product_sales_units` carries the most weight within Proactive (0.35) — buying merchandise is
arguably the clearest signal of committed fandom among the available metrics.

## 5. The final composite score

```python
city_index = 100 × (0.35 × passive_score + 0.65 × proactive_score)
```

Scaled to 0–100 for readability. Cities are then ranked per artist (`rank(ascending=False)` on
`city_index`, grouped by `artist_id`) — rank 1 is the best candidate tour city for that artist. Each
artist's top 10 cities move on to Step 2.

## 6. Expected demand

The index says *which* cities to tour. Choosing a venue also requires knowing *how big* the room
should be, so each city gets a headcount estimate:

```
expected_demand = spotify_monthly_listeners × attendance_rate    (attendance_rate = 0.02)
```

For Nova Reyes in Portland, 234,192 listeners × 0.02 = **4,684 people**.

- **Raw listeners, not scaled scores.** Venue capacity is a headcount, so the estimate needs a real
  number of people. The 0–1 scores are only good for ranking cities.
- **Spotify listeners as the base.** They are the largest, most direct count of people in each city
  who already know the artist's music.
- **The 2% rate is an assumption, not a measurement.** It says about 2 of every 100 local listeners
  will buy a ticket. Changing it moves every city's demand by the same proportion: 5% would turn
  Portland's 4,684 into 11,710.

## 7. Choosing a venue

### Filters

Each venue must pass these checks for a top-10 city:

| Check | Rule | Why |
|---|---|---|
| Distance | Within `radius_miles = 10` of the city center | Keeps the show within reach of the city's fans, and suburbs count |
| Capacity fit | `capacity_fit = capacity ÷ expected_demand` is between 0.5 and 1.5 | Avoids a room so small that fans are turned away, or so big that it looks half-empty |
| Open dates | At least one free day from Mar 1 to Jun 30, 2027 | The venue has to be available. Booked dates are removed, and so are days outside May–Oct for seasonal venues. |

Distance uses the **haversine formula**: the straight-line distance between two latitude/longitude
points, on a sphere with a radius of 3,958.8 miles. It isn't driving distance.

**Genre is not a filter.** Whether a venue books the artist's genre is only passed to the app as
information.

### Score

Venues that pass all three checks get a weighted score, where each piece runs from 0 to 1:

```python
capacity_score    = 1 - |capacity_fit - 1|                # 1.0 when the room matches demand exactly
flexibility_score = min-max of open_weekend_dates         # across that artist's shortlisted venues
distance_score    = 1 - distance_miles / radius_miles     # 1.0 at the city center, 0.0 at the radius edge

venue_score = 0.5 × capacity_score + 0.3 × flexibility_score + 0.2 × distance_score
```

Weekend means Friday to Sunday. The highest-scoring venue in each city is kept as that city's best
venue, and those venues go on to Step 3.

**Worked example** (Nova Reyes, Echo Music Hall in Portland):

| Piece | Input | Score | Weight | Points |
|---|---|---|---|---|
| Capacity | 5,000 ÷ 4,684 = 1.0675 fit | 0.9325 | 0.5 | 0.466 |
| Flexibility | 23 open weekend dates (artist's range is 6 to 33) | 0.6296 | 0.3 | 0.189 |
| Distance | 3.9 miles | 0.61 | 0.2 | 0.122 |
| **Total** | | | | **0.777** |

### Results

In the saved results, 24 of the 30 artist-city pairs have a venue. The other six have no venue that
fits the capacity band within the radius: New York for Nova Reyes, Salt Lake City for The Copper
Pines, and San Diego, New York, Washington and Minneapolis for Kairo Blaze. Widening the radius or the
capacity band would be the next thing to try for these.

## 8. Known limitations

- **Weights are hand-set, not fitted.** The 0.35/0.65 factor split and the per-metric weights are
  reasonable starting assumptions, not derived constants. With real historical ticket-sales data,
  these would ideally be fit via regression against actual sellout outcomes rather than assumed. The
  0.5/0.3/0.2 venue score weights are hand-set too.
- **Index score alone isn't sufficient.** A top-ranked city by this index is a demand-side
  candidate only — it says nothing about venue availability. Step 2 separately filters by distance,
  capacity fit, and open dates; a high `city_index` city can still fail that filter if no suitable
  venue is free. Kairo Blaze's top-ranked city, San Diego, has no qualifying venue.
- **The 50/50 volume/per-capita split is also an assumption.** Which half matters more for actual
  ticket sales (raw reach vs. fan density) is an empirical question this toy dataset can't answer,
  but would be worth testing against real outcomes.
- **The attendance rate is a guess.** The same 2% applies to every city and artist, and it uses
  Spotify listeners only. With real ticket history it should be calculated from past shows (tickets
  sold ÷ local listeners).
- **Venues aren't checked for genre fit.** 6 of the 24 selected venues don't list the artist's
  genre, including every shortlisted option for Nova Reyes in Orlando and for The Copper Pines in
  Las Vegas and Houston.
- **Flexibility scores are relative.** They depend on which other venues are on the artist's shortlist,
  so adding or removing a venue can change the scores of the others.
