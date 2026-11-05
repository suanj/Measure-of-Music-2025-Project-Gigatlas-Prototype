// GigAtlas prototype: four steps that walk through the tour-planner pipeline, with a progress bar.
//   1 Find your fans   -> type an artist
//   2 Plan your route  -> suggested route with gas costs + filters (one card), top cities + each city's fan data
//   3 Choose hotels    -> a hotel per tour city, with a preview (pictures, description, reviews, website)
//   4 Review & book    -> route + trip summary, then "Book hotels"
// Data: index_data.js (Create Index.ipynb) and data.js (Plan Logistics.ipynb).
// The route is re-planned in the browser with the same rules as Plan Logistics.ipynb.
(function () {
  'use strict';
  const I = window.INDEX_DATA, D = window.TOUR_DATA, P = I.params;
  const ROAD_FACTOR = 1.2, MILES_PER_DAY = 450, MAX_STOPS = 8;     // same assumptions as Plan Logistics.ipynb
  const PAGES = ['fans', 'dashboard', 'hotels', 'review'];
  const PAGE_NAMES = ['Find your fans', 'Plan your route', 'Choose hotels', 'Review & book'];

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = new Intl.NumberFormat('en-US');
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const toDay = iso => Math.floor(Date.parse(iso + 'T00:00:00Z') / 864e5);          // days since 1970-01-01
  const dayIso = d => new Date(d * 864e5).toISOString().slice(0, 10);
  const fmtDate = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // ---------------------------------------------------------------- state
  const S = {
    page: 'fans', artistId: null, city: null, showAll: false,
    picks: {}, venueCity: null, ddOpen: false,      // dashboard filters: city -> venue_id
    crew: D.defaults.crew_size, mpg: D.defaults.mpg, minRating: D.defaults.min_rating,
    plan: null, routeConfirmed: false,
    stop: 0, chosen: {}, priceBand: 'any', hotelRating: 0, hotelsConfirmed: false,
    booked: false,
  };
  const artist = () => I.artists.find(a => a.artist_id === S.artistId) || null;
  const tourCities = a => a.cities.filter(c => a.funnel[c.city]);                 // the top cities (go on to venue search)
  const venuesIn = (a, city) => (a.venues[city] || []).map(v => ({ ...v, city }));

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 3000);
  }
  const alertBox = (kind, html) => `<div class="alert ${kind}">${html}</div>`;
  const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  // ---------------------------------------------------------------- huddles (the "i" explanations, no math)
  const HUDDLES = {
    index: ['How the city index works', [
      'We look at the artist\'s fans in each city: people <b>listening</b> (Spotify, YouTube, streams) and people <b>taking action</b> (following on Instagram, watching on YouTube, buying merch and songs).',
      'Actions count for more than listening, because fans who follow and buy are the ones who buy tickets. A city also gets credit when its fans are packed in for its size, so big cities don\'t win just for being big.',
      'Every city gets a score from 0 to 100. Higher means a better tour stop; the top 10 are suggested for the tour.']],
    route: ['How the route is chosen', [
      'Each city uses its best venue: close to the city, the right size for the expected crowd, and free on weekends.',
      'We try every possible order of the cities and keep the cheapest one, counting gas and hotel nights. Each show lands on the venue\'s first free weekend after the bus arrives.',
      'Change the filters next to the map and the route updates.']],
    gas: ['How gas cost is estimated', [
      'From the driving distance between venues, how far the bus goes on a gallon, and the gas prices in the states it drives through.']],
    hotels: ['How hotel cost works', [
      'Two crew members share a room. The crew stays in a hotel every night from a show until the next one, and Friday and Saturday nights use the weekend price.',
      'We start with the cheapest hotel at or above your minimum rating. Pick any other hotel and the trip total updates.']],
  };
  function huddle(key, right) {
    const [title, paras] = HUDDLES[key];
    return `<span class="huddle"><button class="info" type="button" aria-expanded="false" aria-label="${esc(title)}">i</button>` +
      `<span class="pop${right ? ' right' : ''}" role="dialog" aria-label="${esc(title)}" hidden><b class="t">${esc(title)}</b>${paras.map(p => `<p>${p}</p>`).join('')}</span></span>`;
  }
  function closeHuddles(except) {
    document.querySelectorAll('.huddle .info[aria-expanded="true"]').forEach(b => {
      if (b === except) return;
      b.setAttribute('aria-expanded', 'false'); b.nextElementSibling.hidden = true;
    });
  }
  document.addEventListener('click', e => {
    const btn = e.target.closest('.info');
    if (btn) {
      const open = btn.getAttribute('aria-expanded') === 'true';
      closeHuddles(btn);
      btn.setAttribute('aria-expanded', String(!open)); btn.nextElementSibling.hidden = open;
    } else if (!e.target.closest('.pop')) closeHuddles();
    if (!e.target.closest('details.dd')) {                 // close the tour-cities dropdown on an outside click
      document.querySelectorAll('details.dd[open]').forEach(d => d.removeAttribute('open'));
      S.ddOpen = false;
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHuddles(); });
  document.querySelectorAll('[data-huddle]').forEach(el => { el.outerHTML = huddle(el.dataset.huddle, el.dataset.huddle === 'hotels'); });

  // ---------------------------------------------------------------- step 1: find your fans
  function findArtist(q) {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    return I.artists.find(a => a.artist_name.toLowerCase() === s)
      || I.artists.find(a => a.artist_name.toLowerCase().startsWith(s))
      || I.artists.find(a => a.artist_name.toLowerCase().includes(s)) || null;
  }
  function openArtist(a) {
    S.artistId = a.artist_id; S.city = a.cities[0].city_id; S.showAll = false;
    S.picks = defaultPicks(a); S.venueCity = null;
    S.crew = D.defaults.crew_size; S.mpg = D.defaults.mpg; S.minRating = D.defaults.min_rating;
    resetDownstream(); replan();
    go('dashboard');
  }
  $('findForm').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('artistInput').value, a = findArtist(q);
    if (!a) {
      $('findMsg').innerHTML = alertBox('error', q.trim() ? `We couldn't find "<b>${esc(q)}</b>". This prototype has data for the artists below.` : 'Type an artist name first.');
      return;
    }
    $('findMsg').innerHTML = ''; $('artistInput').value = a.artist_name; openArtist(a);
  });
  $('artistList').innerHTML = I.artists.map(a => `<option value="${esc(a.artist_name)}">`).join('');
  $('quickPicks').innerHTML = 'Try: ' + I.artists.map(a => `<button type="button" data-artist="${esc(a.artist_id)}">${esc(a.artist_name)} · ${esc(a.genre)}</button>`).join('');
  $('quickPicks').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const a = I.artists.find(x => x.artist_id === b.dataset.artist); $('artistInput').value = a.artist_name; openArtist(a);
  }));

  // ---------------------------------------------------------------- step 2: plan your route
  function defaultPicks(a) {                 // best venue in each top city, best cities first, up to 8
    const picks = {};
    tourCities(a).forEach(c => {
      const best = (a.venues[c.city] || []).find(v => v.is_best);
      if (best && Object.keys(picks).length < MAX_STOPS) picks[c.city] = best.venue_id;
    });
    return picks;
  }
  function resetDownstream() {
    S.routeConfirmed = false; S.hotelsConfirmed = false; S.booked = false; S.chosen = {}; S.stop = 0;
  }

  function renderDashboard() {
    const a = artist();
    $('dashEyebrow').textContent = `${a.genre} · Tour window ${fmtDate(P.window.start)} – ${fmtDate(P.window.end)}`;
    $('dashTitle').textContent = a.artist_name;
    $('showSel').value = S.showAll ? 'all' : 'top';
    renderFilters(); renderRoute(); renderCities(); renderCityCard();
  }
  $('showSel').addEventListener('change', e => { S.showAll = e.target.value === 'all'; renderCities(); });

  function renderFilters() {
    const a = artist(), picked = Object.keys(S.picks), cities = tourCities(a);
    const multi = picked.filter(city => venuesIn(a, city).length > 1);
    if (!multi.includes(S.venueCity)) S.venueCity = multi[0] || null;
    const opt = (vals, cur, fmt) => vals.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${fmt(v)}</option>`).join('');
    const withCur = (vals, cur) => (vals.includes(cur) ? vals : [...vals, cur].sort((x, y) => x - y));
    $('filters').innerHTML = `
      <h4>Adjust your tour</h4>
      <div class="field"><span>Tour cities (up to ${MAX_STOPS})</span>
        <details class="dd" ${S.ddOpen ? 'open' : ''}><summary>${picked.length} of ${cities.filter(c => venuesIn(a, c.city).length).length} cities selected</summary>
          <div class="menu" role="group" aria-label="Tour cities">
            ${cities.map(c => {
              const has = venuesIn(a, c.city).length > 0, on = !!S.picks[c.city], blocked = !has || (!on && picked.length >= MAX_STOPS);
              return `<label class="opt${blocked ? ' off' : ''}"><input type="checkbox" data-city="${esc(c.city)}" ${on ? 'checked' : ''} ${blocked ? 'disabled' : ''}>
                ${esc(c.city)}, ${esc(c.state)}<small>${has ? '#' + c.rank : 'no venue fits'}</small></label>`;
            }).join('')}
          </div></details></div>
      ${multi.length ? `<div class="field"><span>Change a venue</span>
        <select id="fVenueCity" aria-label="City">${multi.map(c => `<option ${c === S.venueCity ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="fVenue" aria-label="Venue">${venuesIn(a, S.venueCity).map(v => `<option value="${esc(v.venue_id)}" ${S.picks[S.venueCity] === v.venue_id ? 'selected' : ''}>${esc(v.venue)} · ${num.format(v.capacity)} seats</option>`).join('')}</select></div>` : ''}
      <div class="grid2">
        <label class="field"><span>Crew size</span><select id="fCrew">${opt(withCur([4, 6, 8, 10, 12, 16, 20], S.crew), S.crew, v => v + ' people')}</select></label>
        <label class="field"><span>Bus mpg</span><select id="fMpg">${opt(withCur([6, 7, 8, 9, 10, 12], S.mpg), S.mpg, v => v + ' mpg')}</select></label>
      </div>
      <label class="field"><span>Minimum hotel rating</span><select id="fRating">${opt([3, 3.5, 4, 4.5], S.minRating, v => v.toFixed(1) + ' and up')}</select></label>
      <button type="button" class="linkbtn" id="fReset" style="justify-self:start">Reset to the suggested tour</button>`;

    $('filters').querySelector('details.dd').addEventListener('toggle', e => { S.ddOpen = e.target.open; });
    $('filters').querySelectorAll('input[data-city]').forEach(cb => cb.addEventListener('change', () => {
      const city = cb.dataset.city;
      if (cb.checked) S.picks[city] = (venuesIn(a, city).find(v => v.is_best) || venuesIn(a, city)[0]).venue_id;
      else delete S.picks[city];
      S.ddOpen = true; changed();
    }));
    if ($('fVenueCity')) {
      $('fVenueCity').addEventListener('change', e => { S.venueCity = e.target.value; renderFilters(); });
      $('fVenue').addEventListener('change', e => { S.picks[S.venueCity] = e.target.value; changed(); });
    }
    $('fCrew').addEventListener('change', e => { S.crew = +e.target.value; changed(); });
    $('fMpg').addEventListener('change', e => { S.mpg = +e.target.value; changed(); });
    $('fRating').addEventListener('change', e => { S.minRating = +e.target.value; changed(); });
    $('fReset').addEventListener('click', () => {
      S.picks = defaultPicks(a); S.crew = D.defaults.crew_size; S.mpg = D.defaults.mpg; S.minRating = D.defaults.min_rating; S.ddOpen = false; changed();
    });
  }

  function changed() {                    // a filter changed: re-plan and redraw the dashboard
    resetDownstream(); replan();
    renderFilters(); renderRoute(); renderCities(); renderCityCard(); renderProgress();
  }
  function replan() {
    const a = artist();
    const picked = Object.entries(S.picks).map(([city, id]) => venuesIn(a, city).find(v => v.venue_id === id)).filter(Boolean);
    S.plan = picked.length >= 2 ? planTour(picked, { crew: S.crew, mpg: S.mpg, minRating: S.minRating }) : null;
  }

  function renderRoute() {
    const t = S.plan;
    $('confirmBtn').disabled = !t;
    if (!t) {
      $('routeMsg').innerHTML = alertBox('warn', 'Pick at least two tour cities in the filters to plan a route.');
      $('routeStats').innerHTML = ''; $('schedule').innerHTML = ''; $('confirmNote').textContent = '';
      drawMap('map', null); return;
    }
    $('routeMsg').innerHTML = t.skipped.length
      ? alertBox('warn', `No free weekend date was left for ${t.skipped.map(v => esc(v.city)).join(', ')} after the other shows, so it's left out.`) : '';
    $('routeStats').innerHTML = statTiles(t, t.lodging, 'Hotels (estimate)');
    $('schedule').innerHTML = `<div class="table-wrap" style="margin-top:14px"><table class="t"><thead><tr>
        <th>#</th><th>City</th><th>Venue</th><th>Show date</th><th class="n">Drive</th><th class="n">Gas price</th>
        <th class="n"><span style="display:inline-flex;gap:6px;align-items:center">Gas cost ${huddle('gas', true)}</span></th></tr></thead><tbody>
      ${t.stops.map((s, i) => `<tr><td class="rk">${i + 1}</td><td>${esc(s.venue.city)}, ${esc(s.venue.state)}</td><td>${esc(s.venue.venue)}</td>
        <td>${fmtDate(s.date)}</td><td class="n">${i ? num.format(Math.round(s.driveMiles)) + ' mi' : 'Start'}</td>
        <td class="n">${usd2.format(D.gas[s.venue.state])}/gal</td><td class="n">${i ? usd2.format(s.fuelCost) : '—'}</td></tr>`).join('')}
      </tbody></table></div>`;
    $('confirmNote').textContent = `${plural(t.stops.length, 'show')} · ${fmtDate(t.stops[0].date)} – ${fmtDate(t.stops[t.stops.length - 1].date)}`;
    drawMap('map', t);
  }
  const statTiles = (t, hotelCost, hotelLabel) => `
      <div class="stat"><div class="k">Gas</div><div class="v">${usd.format(t.fuel)}</div></div>
      <div class="stat"><div class="k">${hotelLabel}</div><div class="v">${usd.format(hotelCost)}</div></div>
      <div class="stat total"><div class="k">Total</div><div class="v">${usd.format(t.fuel + hotelCost)}</div></div>
      <div class="stat"><div class="k">Miles</div><div class="v">${num.format(Math.round(t.miles))}</div></div>
      <div class="stat"><div class="k">Days</div><div class="v">${t.days}</div></div>`;

  function renderCities() {
    const a = artist(), tops = new Set(tourCities(a).map(c => c.city_id));
    const rows = S.showAll ? a.cities : a.cities.filter(c => tops.has(c.city_id));
    $('citiesTable').innerHTML = `<div class="table-wrap"><table class="t click"><thead><tr>
        <th>#</th><th>City</th><th>State</th><th class="n">City index</th><th>On tour</th></tr></thead><tbody>
      ${rows.map(c => `<tr data-id="${esc(c.city_id)}" class="${c.city_id === S.city ? 'sel' : ''}${tops.has(c.city_id) ? '' : ' dim'}" tabindex="0">
        <td class="rk">${c.rank}</td><td>${esc(c.city)}</td><td>${esc(c.state)}</td><td class="n score">${c.city_index.toFixed(1)}</td>
        <td>${S.picks[c.city] ? '<span class="tag good">In route</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
    $('citiesTable').querySelectorAll('tbody tr').forEach(tr => {
      const pick = () => { S.city = tr.dataset.id; renderCities(); renderCityCard(); if (window.innerWidth < 1000) $('cityCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') pick(); });
    });
  }

  function renderCityCard() {
    const a = artist(), c = a.cities.find(x => x.city_id === S.city);
    const fmtRaw = (m, v) => (m.count ? num.format(v) : v.toFixed(2));
    const vs = venuesIn(a, c.city), inTop = !!a.funnel[c.city];
    $('cityCard').innerHTML = `
      <label class="field"><span>City</span><select id="citySel">${a.cities.map(x => `<option value="${esc(x.city_id)}" ${x.city_id === S.city ? 'selected' : ''}>#${x.rank} ${esc(x.city)}, ${esc(x.state)}</option>`).join('')}</select></label>
      <div class="city-top" style="margin-top:14px">
        <div><div class="eyebrow">#${c.rank} of ${a.cities.length} cities</div><h3 style="font-size:22px">${esc(c.city)}, ${esc(c.state)}</h3></div>
        <div class="big"><span class="v">${c.city_index.toFixed(1)}</span><span class="k">City index ${huddle('index', true)}</span></div>
      </div>
      <div class="subh">Fan data</div>
      <dl class="kv">
        ${I.metrics.map(m => `<dt>${esc(m.label)}</dt><dd>${fmtRaw(m, c.raw[m.key])}</dd>`).join('')}
        <dt>Metro population</dt><dd>${num.format(c.metro_population)}</dd>
      </dl>
      <div class="subh">Venues that fit</div>
      ${!inTop ? `<p class="muted small">Not in the top ${tourCities(a).length} cities, so no venues were searched here.</p>`
        : vs.length ? `<div class="vlist">${vs.map(v => `<div class="vitem"><b>${esc(v.venue)}</b>${S.picks[c.city] === v.venue_id ? '<span class="tag good">In route</span>' : ''}<br>
            ${esc(v.type)} · ${esc(v.locality)} · ${num.format(v.capacity)} seats · ${v.distance_miles.toFixed(1)} mi away<br>
            Avg ticket ${usd.format(v.avg_ticket_price_usd)} · ${v.open_weekend_dates} free weekend dates</div>`).join('')}</div>`
        : `<p class="muted small">No venue here is close enough, the right size and free in the tour window.</p>`}`;
    $('citySel').addEventListener('change', e => { S.city = e.target.value; renderCities(); renderCityCard(); });
  }

  // ---- the route planner: same rules as Plan Logistics.ipynb ----
  function haversineMiles(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(a));
  }
  const typical = h => (5 * h.price_weekday_usd + 2 * h.price_weekend_usd) / 7;      // 5 weekday + 2 weekend nights
  function cheapestHotel(cityId, minRating) {
    const inCity = D.hotels[cityId] || [];
    let good = inCity.filter(h => h.rating >= minRating);
    if (!good.length) good = [inCity.reduce((x, y) => (y.rating > x.rating ? y : x))];
    return good.reduce((x, y) => (typical(y) < typical(x) ? y : x));
  }
  function stayCost(hotel, day, nights, rooms) {       // a hotel every night; Fri and Sat nights use the weekend price
    let cost = 0;
    for (let d = day; d < day + nights; d++) {
      const wd = (d + 4) % 7;                            // 0 = Sun ... 5 = Fri, 6 = Sat
      cost += rooms * (wd === 5 || wd === 6 ? hotel.price_weekend_usd : hotel.price_weekday_usd);
    }
    return cost;
  }

  function planTour(vs, p) {
    const n = vs.length, rooms = Math.ceil(p.crew / 2);
    const start = toDay(P.window.start), end = toDay(P.window.end);
    const miles = vs.map(a => vs.map(b => ROAD_FACTOR * haversineMiles(a.lat, a.lon, b.lat, b.lon)));
    const gas = vs.map(v => D.gas[v.state]);
    const fuel = miles.map((row, i) => row.map((m, j) => m / p.mpg * (gas[i] + gas[j]) / 2));
    const hotels = vs.map(v => cheapestHotel(v.city_id, p.minRating));
    const open = vs.map(v => v.weekend_dates.map(toDay));

    function schedule(order) {
      const shows = [], skipped = [];
      for (const k of order) {
        let earliest = start, driveMiles = 0, legFuel = 0;
        if (shows.length) {
          const prev = shows[shows.length - 1];
          driveMiles = miles[prev.stop][k];
          earliest = prev.day + Math.max(1, Math.ceil(driveMiles / MILES_PER_DAY));
          legFuel = fuel[prev.stop][k];
        }
        const day = open[k].find(d => d >= earliest);              // first free weekend date after arriving
        if (day === undefined || day > end) { skipped.push(k); continue; }
        shows.push({ stop: k, day, driveMiles, fuelCost: legFuel });
      }
      let cost = 0;
      shows.forEach((s, j) => {
        s.nights = (j + 1 < shows.length ? shows[j + 1].day : s.day + 1) - s.day;
        s.lodgingCost = stayCost(hotels[s.stop], s.day, s.nights, rooms);
        cost += s.fuelCost + s.lodgingCost;
      });
      return { shows, skipped, cost };
    }

    // try every order (same order as Python's itertools.permutations) and keep the cheapest; skipping a city loses
    let best = null;
    const used = Array(n).fill(false), order = [];
    (function permute() {
      if (order.length === n) {
        const r = schedule(order);
        if (!best || r.skipped.length < best.skipped.length || (r.skipped.length === best.skipped.length && r.cost < best.cost)) best = r;
        return;
      }
      for (let i = 0; i < n; i++) if (!used[i]) { used[i] = true; order.push(i); permute(); order.pop(); used[i] = false; }
    })();

    const stops = best.shows.map(s => ({ ...s, venue: vs[s.stop], hotel: hotels[s.stop], date: dayIso(s.day) }));
    const fuelTotal = stops.reduce((t, s) => t + s.fuelCost, 0), lodgingTotal = stops.reduce((t, s) => t + s.lodgingCost, 0);
    return {
      stops, skipped: best.skipped.map(k => vs[k]), rooms, fuel: fuelTotal, lodging: lodgingTotal, total: fuelTotal + lodgingTotal,
      miles: stops.reduce((t, s) => t + s.driveMiles, 0), days: stops[stops.length - 1].day - stops[0].day + 1,
    };
  }

  // ---- maps: bundled state outlines (no tile server); one on the route step, one on the review step ----
  const maps = {};
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function drawBase(m) {
    if (m.base) m.map.removeLayer(m.base);
    m.base = L.geoJSON(window.US_STATES, { interactive: false, style: { color: css('--state-line'), weight: 1, fillColor: css('--land'), fillOpacity: 1 } }).addTo(m.map);
    m.base.bringToBack();
  }
  function drawMap(id, t) {
    if (!window.L || $(id).closest('main').hidden) return;
    if (!maps[id]) {
      const map = L.map(id, { scrollWheelZoom: false, zoomSnap: 0.25 }).setView([39, -97], 3.5);
      map.attributionControl.addAttribution('State outlines: Natural Earth (public domain)');
      maps[id] = { map, layer: L.layerGroup().addTo(map) }; drawBase(maps[id]);
    }
    const m = maps[id]; m.map.invalidateSize(); m.layer.clearLayers();
    if (!t) { m.map.setView([39, -97], 3.5); return; }
    const pts = t.stops.map(s => [s.venue.lat, s.venue.lon]);
    m.map.fitBounds(pts, { padding: [36, 36], animate: false });      // set the view first so the route lines aren't clipped
    t.stops.forEach((s, i) => {
      if (i) L.polyline([pts[i - 1], pts[i]], { color: css('--accent'), weight: 3, opacity: .85 })
        .bindTooltip(`${esc(t.stops[i - 1].venue.city)} to ${esc(s.venue.city)}: ${num.format(Math.round(s.driveMiles))} mi · gas ${usd2.format(s.fuelCost)}`, { sticky: true }).addTo(m.layer);
    });
    t.stops.forEach((s, i) => {
      L.marker(pts[i], { icon: L.divIcon({ className: '', html: `<div class="pin">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
        .bindPopup(`<b>${i + 1}. ${esc(s.venue.venue)}</b><br>${esc(s.venue.city)}, ${esc(s.venue.state)} · ${fmtDate(s.date)}<br>Gas here ${usd2.format(D.gas[s.venue.state])}/gal`)
        .bindTooltip(esc(s.venue.city), { permanent: true, direction: 'right', offset: [14, 0], className: 'city-label' }).addTo(m.layer);
    });
  }

  $('confirmBtn').addEventListener('click', () => {
    if (!S.plan) return;
    S.routeConfirmed = true;
    if (!Object.keys(S.chosen).length) S.plan.stops.forEach((s, i) => { S.chosen[i] = s.hotel.hotel_id; });
    go('hotels');
  });

  // ---------------------------------------------------------------- step 3: choose hotels
  const ratingWord = r => (r >= 4.6 ? 'Exceptional' : r >= 4.3 ? 'Wonderful' : r >= 4.0 ? 'Very good' : r >= 3.5 ? 'Good' : 'Fair');
  const hotelsOf = stop => D.hotels[stop.venue.city_id] || [];
  const chosenHotel = i => hotelsOf(S.plan.stops[i]).find(h => h.hotel_id === S.chosen[i]);
  const PRICE_BANDS = { any: ['Any price', 0, 1e9], u100: ['Up to $100', 0, 100], b150: ['$100 – $150', 100, 150], b200: ['$150 – $200', 150, 200], o200: ['$200 and up', 200, 1e9] };

  // placeholder content: the toy data has no photos, descriptions, reviews or websites
  const KINDS = { Inn: 'cozy inn', Suites: 'all-suite hotel', Hotel: 'city hotel', Lodge: 'relaxed lodge', Plaza: 'full-service hotel', Motel: 'budget motel' };
  const AMENITIES = ['Free Wi-Fi', 'Breakfast included', 'Bus and trailer parking', 'Late check-in', 'Fitness room', 'Laundry', 'Pool', '24-hour front desk', 'Room service', 'Early check-out'];
  const PALETTES = [['#c96f53', '#f2d0a4'], ['#4f6d7a', '#c0d6df'], ['#7b6d8d', '#d9c8e8'], ['#5b8c5a', '#cfe3c4'], ['#b08d57', '#efe0bf'], ['#3e5c76', '#b7c9da']];
  function picture(h, kind) {
    const k = hash(h.hotel_id + kind), [dark, light] = PALETTES[k % PALETTES.length];
    let body;
    if (kind === 'outside') {
      const floors = 4 + (k % 3), cols = 5;
      let win = '';
      for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) win += `<rect x="${78 + c * 34}" y="${40 + f * 26}" width="18" height="14" fill="${(k >> (f + c)) & 1 ? '#ffe9a8' : light}"/>`;
      body = `<rect width="320" height="240" fill="#bfe0f2"/><rect y="200" width="320" height="40" fill="#8a8f98"/>
        <rect x="62" y="${30}" width="196" height="${floors * 26 + 22}" fill="${dark}"/>${win}
        <rect x="140" y="${52 + floors * 26}" width="40" height="${148 - floors * 26}" fill="#3a3a3a"/>
        <rect x="96" y="14" width="128" height="18" rx="3" fill="#222"/><rect x="104" y="20" width="112" height="6" fill="${light}"/>`;
    } else if (kind === 'room') {
      body = `<rect width="320" height="240" fill="${light}"/><rect y="170" width="320" height="70" fill="#9b8574"/>
        <rect x="40" y="40" width="80" height="60" fill="#dff1fb" stroke="#fff" stroke-width="6"/>
        <rect x="120" y="120" width="170" height="70" rx="6" fill="#fff"/><rect x="120" y="150" width="170" height="40" fill="${dark}"/>
        <rect x="132" y="108" width="60" height="24" rx="8" fill="#f4f4f4"/><rect x="214" y="108" width="60" height="24" rx="8" fill="#f4f4f4"/>
        <rect x="60" y="140" width="40" height="40" fill="#6b5847"/><circle cx="80" cy="128" r="14" fill="#ffe9a8"/>`;
    } else {
      body = `<rect width="320" height="240" fill="#efe9df"/><rect y="180" width="320" height="60" fill="#c9bba6"/>
        <rect x="30" y="110" width="150" height="70" fill="${dark}"/><rect x="30" y="104" width="150" height="10" fill="#3a3a3a"/>
        <rect x="210" y="40" width="80" height="140" fill="${light}"/><circle cx="250" cy="70" r="16" fill="#ffe9a8"/>
        <rect x="236" y="150" width="28" height="30" fill="#7a5c45"/><circle cx="250" cy="138" r="18" fill="#5b8c5a"/>`;
    }
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">${body}</svg>`);
  }
  function description(h, stop) {
    const suffix = h.hotel_name.split(' ').pop(), kind = KINDS[suffix] || 'hotel', k = hash(h.hotel_id);
    const am = AMENITIES.filter((_, i) => (k >> i) & 1).slice(0, 4);
    if (am.length < 2) am.push('Free Wi-Fi', 'Late check-in');
    return {
      text: `${h.hotel_name} is a ${kind} in ${stop.venue.city}, ${stop.venue.state}, rated ${h.rating.toFixed(1)} out of 5 by guests (${ratingWord(h.rating).toLowerCase()}). ` +
            `Rooms are ${usd.format(h.price_weekday_usd)} on weeknights and ${usd.format(h.price_weekend_usd)} on Friday and Saturday nights.`,
      amenities: [...new Set(am)],
    };
  }

  function renderHotels() {
    const t = S.plan, a = artist(), s = t.stops[S.stop];
    $('hotelEyebrow').textContent = `${a.artist_name} · ${t.stops.length} tour cities · ${t.rooms} rooms a night (crew of ${S.crew})`;
    $('stopSel').innerHTML = t.stops.map((x, i) => `<option value="${i}" ${i === S.stop ? 'selected' : ''}>${i + 1}. ${esc(x.venue.city)}, ${esc(x.venue.state)} · ${fmtDate(x.date)}</option>`).join('');
    $('priceSel').innerHTML = Object.entries(PRICE_BANDS).map(([k, [label]]) => `<option value="${k}" ${k === S.priceBand ? 'selected' : ''}>${label}</option>`).join('');
    $('ratingSel').innerHTML = [0, 3.5, 4, 4.5].map(r => `<option value="${r}" ${r === S.hotelRating ? 'selected' : ''}>${r ? r.toFixed(1) + ' and up' : 'Any rating'}</option>`).join('');
    $('stayNote').textContent = `Show at ${s.venue.venue} on ${fmtDate(s.date)} · ${plural(s.nights, 'night')} in ${s.venue.city} · ${t.rooms} rooms.`;

    const [, lo, hi] = PRICE_BANDS[S.priceBand];
    const list = hotelsOf(s).filter(h => (h.price_weekday_usd >= lo && h.price_weekday_usd <= hi && h.rating >= S.hotelRating) || h.hotel_id === S.chosen[S.stop])
      .sort((x, y) => x.price_weekday_usd - y.price_weekday_usd);
    $('hotelList').innerHTML = list.length ? list.map(h => {
      const on = h.hotel_id === S.chosen[S.stop], d = description(h, s);
      return `<div class="hotel${on ? ' chosen' : ''}">
        <div class="h-row">
          <input type="radio" name="pick" value="${esc(h.hotel_id)}" ${on ? 'checked' : ''} aria-label="Choose ${esc(h.hotel_name)}">
          <div><b>${esc(h.hotel_name)}</b>${h.hotel_id === s.hotel.hotel_id ? '<span class="tag">Suggested</span>' : ''}${on ? '<span class="tag good">Chosen</span>' : ''}</div>
          <div><span class="k">Price</span><span class="n">${usd.format(h.price_weekday_usd)}</span></div>
          <div><span class="k">Weekend</span><span class="n">${usd.format(h.price_weekend_usd)}</span></div>
          <div><span class="k">Rating</span><a href="#" class="rev-link" data-id="${esc(h.hotel_id)}">${h.rating.toFixed(1)} / 5 · ${ratingWord(h.rating)}</a></div>
          <div><span class="k">Stay cost</span><span class="n">${usd.format(stayCost(h, s.day, s.nights, t.rooms))}</span></div>
        </div>
        <div class="preview">
          <div class="photos">${['outside', 'room', 'lobby'].map(k => `<figure><img src="${picture(h, k)}" alt="Illustration of the ${k} of ${esc(h.hotel_name)}"><figcaption>${k[0].toUpperCase() + k.slice(1)} (illustration)</figcaption></figure>`).join('')}</div>
          <p>${esc(d.text)}</p>
          <div class="amen">${d.amenities.map(x => `<span>${esc(x)}</span>`).join('')}</div>
          <div class="links">
            <a href="#" class="rev-link" data-id="${esc(h.hotel_id)}">Read guest reviews (${h.rating.toFixed(1)} / 5)</a>
            <a href="#" class="site-link" data-name="${esc(h.hotel_name)}">Visit hotel website</a>
            ${on ? '<span class="tag good">This is your hotel</span>' : `<button type="button" class="btn primary choose-btn" data-id="${esc(h.hotel_id)}">Choose this hotel</button>`}
          </div>
        </div>
      </div>`;
    }).join('') + `<p class="muted small" style="margin-top:10px">Price = a weekday night per room · Weekend = Friday and Saturday nights · Stay cost = all ${t.rooms} rooms for ${plural(s.nights, 'night')}.</p>`
      : alertBox('warn', 'No hotels match these filters. Try another price range or rating.');

    const choose = id => { S.chosen[S.stop] = id; S.hotelsConfirmed = false; S.booked = false; renderHotels(); renderProgress(); };
    $('hotelList').querySelectorAll('input[name=pick]').forEach(r => r.addEventListener('change', () => choose(r.value)));
    $('hotelList').querySelectorAll('.choose-btn').forEach(b => b.addEventListener('click', () => choose(b.dataset.id)));
    $('hotelList').querySelectorAll('.rev-link').forEach(x => x.addEventListener('click', e => { e.preventDefault(); openReviews(hotelsOf(s).find(h => h.hotel_id === x.dataset.id), s); }));
    $('hotelList').querySelectorAll('.site-link').forEach(x => x.addEventListener('click', e => { e.preventDefault(); toast(`Prototype: ${x.dataset.name} is a toy hotel, so there is no real website. A live version would open the hotel's own site here.`); }));
    renderTrip();
  }
  $('stopSel').addEventListener('change', e => { S.stop = +e.target.value; renderHotels(); });
  $('priceSel').addEventListener('change', e => { S.priceBand = e.target.value; renderHotels(); });
  $('ratingSel').addEventListener('change', e => { S.hotelRating = +e.target.value; renderHotels(); });

  function openReviews(h, stop) {
    const k = hash(h.hotel_id), clamp = x => Math.max(1, Math.min(5, x));
    const cats = ['Cleanliness', 'Location', 'Staff', 'Value'].map((c, i) => [c, clamp(h.rating + (((k >> (i * 3)) & 7) - 3.5) / 10)]);
    const good = ['Quiet rooms and the bus fit in the lot.', 'Staff held our gear overnight, very helpful.', 'Clean, simple, close to the venue.', 'Easy late check-in after the show.'];
    const meh = ['Thin walls, but fine for one night.', 'Breakfast ends early for a touring crew.', 'Parking for a trailer was tight.'];
    const pool = h.rating >= 4 ? good : [...good.slice(0, 2), ...meh];
    const cities = ['Denver', 'Austin', 'Columbus', 'Raleigh', 'Boise', 'Tampa'];
    $('dlgTitle').textContent = `${h.hotel_name} · ${stop.venue.city}`;
    $('dlgBody').innerHTML = `
      <div><span class="big" style="text-align:left"><span class="v">${h.rating.toFixed(1)}</span></span> <span class="muted">out of 5 · ${ratingWord(h.rating)}</span></div>
      ${cats.map(([c, v]) => `<div class="cat"><span>${c}</span><span class="tr"><i style="width:${v / 5 * 100}%"></i></span><span>${v.toFixed(1)}</span></div>`).join('')}
      ${[0, 1, 2].map(i => `<div class="rev"><b>"${esc(pool[(k + i) % pool.length])}"</b><small>Guest from ${cities[(k >> i) % cities.length]} · ${clamp(Math.round((h.rating + ((k >> (i + 5)) % 3 - 1) * 0.4) * 2) / 2).toFixed(1)} / 5</small></div>`).join('')}
      <p class="muted small">Sample reviews generated for this prototype. A live version would link to the full reviews on the booking site.</p>`;
    $('reviewDlg').showModal();
  }
  $('dlgClose').addEventListener('click', () => $('reviewDlg').close());
  $('reviewDlg').addEventListener('click', e => { if (e.target === $('reviewDlg')) $('reviewDlg').close(); });

  function tripTotals() {
    const t = S.plan;
    const rows = t.stops.map((s, i) => { const h = chosenHotel(i); return { s, h, cost: h ? stayCost(h, s.day, s.nights, t.rooms) : 0 }; });
    return { rows, hotel: rows.reduce((x, r) => x + r.cost, 0) };
  }
  function renderTrip() {
    const t = S.plan, { rows, hotel } = tripTotals();
    $('tripSummary').innerHTML = `<h3>Your trip</h3>
      <button class="btn primary" id="confirmHotels" type="button" style="width:100%;margin:12px 0 4px">Confirm hotels →</button>
      <div class="stats" style="grid-template-columns:1fr 1fr">
        <div class="stat"><div class="k">Gas</div><div class="v">${usd.format(t.fuel)}</div></div>
        <div class="stat"><div class="k">Hotels</div><div class="v">${usd.format(hotel)}</div></div>
        <div class="stat total" style="grid-column:1/-1"><div class="k">Trip total</div><div class="v">${usd.format(t.fuel + hotel)}</div></div>
      </div>
      <div class="sumlist">${rows.map(({ s, h, cost }, i) => `<div class="sumrow"><button type="button" data-i="${i}"><b>${i + 1}. ${esc(s.venue.city)}</b>
        <small>${h ? esc(h.hotel_name) + ' · ' + plural(s.nights, 'night') : 'No hotel chosen'}</small></button><span>${usd.format(cost)}</span></div>`).join('')}</div>`;
    $('tripSummary').querySelectorAll('.sumrow button').forEach(b => b.addEventListener('click', () => { S.stop = +b.dataset.i; renderHotels(); }));
    $('confirmHotels').addEventListener('click', () => { S.hotelsConfirmed = true; go('review'); });
  }

  // ---------------------------------------------------------------- step 4: review & book
  function renderReview() {
    const t = S.plan, a = artist(), { rows, hotel } = tripTotals();
    $('reviewEyebrow').textContent = `${a.artist_name} · ${a.genre} · ${fmtDate(t.stops[0].date)} – ${fmtDate(t.stops[t.stops.length - 1].date)}`;
    $('bookMsg').innerHTML = S.booked ? `<div class="done-box"><h3>Hotels booked</h3>
        Booking requests were prepared for ${plural(rows.length, 'hotel')} (${t.rooms} rooms each, ${usd.format(hotel)} in total). This is a prototype on toy data, so nothing was actually booked.</div>` : '';
    $('itinerary').innerHTML = `<div class="table-wrap"><table class="t"><thead><tr>
        <th>#</th><th>Date</th><th>City</th><th>Venue</th><th class="n">Drive</th><th class="n">Gas</th><th>Hotel</th><th class="n">Nights</th><th class="n">Hotel cost</th></tr></thead><tbody>
      ${rows.map(({ s, h, cost }, i) => `<tr><td class="rk">${i + 1}</td><td>${fmtDate(s.date)}</td><td>${esc(s.venue.city)}, ${esc(s.venue.state)}</td><td>${esc(s.venue.venue)}</td>
        <td class="n">${i ? num.format(Math.round(s.driveMiles)) + ' mi' : 'Start'}</td><td class="n">${i ? usd.format(s.fuelCost) : '—'}</td>
        <td>${h ? esc(h.hotel_name) : '—'}</td><td class="n">${s.nights}</td><td class="n">${usd.format(cost)}</td></tr>`).join('')}
      </tbody></table></div>`;
    $('reviewSummary').innerHTML = `<h3>Trip summary</h3>
      <div class="stats" style="grid-template-columns:1fr 1fr">${statTiles(t, hotel, 'Hotels')}</div>
      <dl class="kv">
        <dt>Shows</dt><dd>${t.stops.length}</dd>
        <dt>Crew</dt><dd>${S.crew} people · ${t.rooms} rooms</dd>
        <dt>Bus</dt><dd>${S.mpg} mpg</dd>
        <dt>Hotel nights</dt><dd>${rows.reduce((x, r) => x + r.s.nights, 0)}</dd>
        ${t.skipped.length ? `<dt>Left out</dt><dd>${t.skipped.map(v => esc(v.city)).join(', ')}</dd>` : ''}
      </dl>
      <button class="btn primary" id="bookBtn" type="button" style="width:100%;margin-top:16px" ${S.booked ? 'disabled' : ''}>${S.booked ? 'Hotels booked' : 'Book hotels'}</button>
      <p class="muted small" style="margin-top:8px">Prototype: booking is simulated, no real reservation is made.</p>`;
    $('bookBtn').addEventListener('click', () => { S.booked = true; renderReview(); renderProgress(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    drawMap('map2', t);
  }

  // ---------------------------------------------------------------- progress bar + navigation
  const reachable = p => p === 'fans' || (p === 'dashboard' && !!S.artistId) || (p === 'hotels' && S.routeConfirmed) || (p === 'review' && S.hotelsConfirmed);
  function renderProgress() {
    const cur = PAGES.indexOf(S.page);
    document.querySelectorAll('#steps li').forEach((li, i) => {
      const done = S.booked || i < cur;
      li.className = done ? 'done' : i === cur ? 'current' : '';
      const b = li.querySelector('button');
      b.disabled = !reachable(PAGES[i]);
      b.setAttribute('aria-current', i === cur ? 'step' : 'false');
    });
    const pct = S.booked ? 100 : Math.round((cur + 0.5) / PAGES.length * 100);
    $('pfill').style.width = pct + '%'; $('pfill').classList.toggle('complete', S.booked);
    $('pbar').setAttribute('aria-valuenow', pct);
    const left = PAGES.length - 1 - cur;
    $('ptext').innerHTML = S.booked ? '<b>All done.</b> Your tour is planned and the hotels are booked.'
      : `Step ${cur + 1} of ${PAGES.length}: <b>${PAGE_NAMES[cur]}</b> · ${left ? plural(left, 'step') + ' left to finalize' : 'last step'}`;
  }
  function go(page) {
    if (!reachable(page)) page = ['review', 'hotels', 'dashboard', 'fans'].find(reachable);
    S.page = page;
    PAGES.forEach(p => { $('page-' + p).hidden = p !== page; });
    closeHuddles(); renderProgress();
    if (location.hash !== '#' + page) history.replaceState(null, '', '#' + page);
    if (page === 'dashboard') renderDashboard();
    if (page === 'hotels') renderHotels();
    if (page === 'review') renderReview();
    if (page === 'fans') setTimeout(() => $('artistInput').focus(), 0);
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('#steps button').forEach(b => b.addEventListener('click', () => go(b.dataset.page)));
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => go(b.dataset.goto)));
  window.addEventListener('hashchange', () => { const p = location.hash.slice(1); if (p && p !== S.page) go(p); });

  const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const themeChanged = () => {
    Object.values(maps).forEach(drawBase);
    if (S.page === 'dashboard') drawMap('map', S.plan);
    if (S.page === 'review') drawMap('map2', S.plan);
  };
  $('themeBtn').addEventListener('click', () => { document.documentElement.dataset.theme = isDark() ? 'light' : 'dark'; themeChanged(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);

  // ?artist=Nova%20Reyes opens that artist straight away (handy for sharing a link)
  const qa = new URLSearchParams(location.search).get('artist');
  const startArtist = qa && findArtist(qa);
  if (startArtist) { $('artistInput').value = startArtist.artist_name; openArtist(startArtist); } else go('fans');
})();
