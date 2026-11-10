"""Sun-glare validation against St. Louis County crash records.
Usage: analyse.py <crashes.csv> <out.json>"""
import sys, json, datetime, zoneinfo
import numpy as np, pandas as pd
from scipy.spatial import cKDTree
RAD = np.pi / 180
rng = np.random.default_rng(20261110)

def sun(ts_ms, lat, lng):
    d = ts_ms / 86400000 - 0.5 + 2440588 - 2451545
    M = RAD * (357.5291 + 0.98560028 * d)
    C = RAD * (1.9148 * np.sin(M) + 0.02 * np.sin(2 * M) + 0.0003 * np.sin(3 * M))
    L = M + C + RAD * 102.9372 + np.pi; e = RAD * 23.4397
    dec = np.arcsin(np.sin(e) * np.sin(L)); ra = np.arctan2(np.sin(L) * np.cos(e), np.cos(L))
    phi = RAD * lat; H = RAD * (280.16 + 360.9856235 * d) + RAD * lng - ra
    az = np.arctan2(np.sin(H), np.cos(H) * np.sin(phi) - np.tan(dec) * np.cos(phi))
    alt = np.arcsin(np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.cos(H))
    return (az / RAD + 180) % 360, alt / RAD

def score(axis, az, alt):
    """App's glare score for a two-way road whose axis bearing is `axis` (0-180)."""
    d = np.abs((axis - az + 90) % 180 - 90)                      # angle between road axis and sun direction
    f = np.where(alt < 0, 0.6, np.where(alt <= 15, 1.0, (25 - alt) / 10))
    s = f * (1 - d / 30)
    return np.where((alt > -0.5) & (alt < 25) & (d < 30), s, 0.0)

d = pd.read_csv(sys.argv[1], low_memory=False)
log = {'rows_in_file': int(len(d))}
d = d.drop_duplicates(subset=['Accident_Date', 'Accident_Time', 'latdd', 'londd', 'On_Road'])
log['after_removing_duplicates'] = int(len(d))
d = d[(d.Accident_Time > 0) & (d.Accident_Time % 100 < 60) & d.latdd.between(38.3, 38.95) & d.londd.between(-90.85, -90.1)]
d = d[d.On_Road.notna()]
d['road'] = d.On_Road.str.upper().str.strip()
d = d[~d.road.isin(['PRIVATE PROPERTY', 'PARKING LOT', 'UNKNOWN', ''])].reset_index(drop=True)
log['with_valid_time_place_and_road'] = int(len(d))

# local road direction from the crashes themselves: principal axis of same-road crashes within 400 m
lat0 = d.latdd.mean()
x = (d.londd.values - d.londd.mean()) * 111320 * np.cos(lat0 * RAD); y = (d.latdd.values - lat0) * 111320
axis = np.full(len(d), np.nan)
for road, idx in d.groupby('road').indices.items():
    if len(idx) < 5: continue
    P = np.c_[x[idx], y[idx]]; tree = cKDTree(P)
    for j, nb in enumerate(tree.query_ball_point(P, 400)):
        if len(nb) < 5: continue
        Q = P[nb] - P[nb].mean(0); cov = Q.T @ Q
        w, v = np.linalg.eigh(cov)
        if w[1] <= 0 or w[0] / w[1] > 0.06 or np.sqrt(w[1] / len(nb)) < 40: continue   # must be a clear line, spread out
        axis[idx[j]] = (np.degrees(np.arctan2(v[0, 1], v[1, 1]))) % 180
d['axis'] = axis
d = d[d.axis.notna()].reset_index(drop=True)
log['with_estimated_road_direction'] = int(len(d))

tz = zoneinfo.ZoneInfo('America/Chicago')
dates = pd.to_datetime(d.Accident_Date.str[:10])
udates = sorted(dates.unique())
off = {u: datetime.datetime(pd.Timestamp(u).year, pd.Timestamp(u).month, pd.Timestamp(u).day, 12, tzinfo=tz).utcoffset().total_seconds() for u in udates}
day_ms = (dates.astype('int64') // 10**6 if str(dates.dtype).endswith('[ns]') else dates.astype('datetime64[ms]').astype('int64')).values.astype(float)
day_ms = dates.values.astype('datetime64[ms]').astype('int64').astype(float)
off_ms = dates.map(off).values * 1000.0
mins = (d.Accident_Time // 100 * 60 + d.Accident_Time % 100).values.astype(float)
hour = (d.Accident_Time // 100).values
lat = d.latdd.values; lng = d.londd.values; ax = d.axis.values

def flags(day_ms, off_ms):
    az, alt = sun(day_ms + mins * 60000 - off_ms, lat, lng)
    s = score(ax, az, alt)
    return s, alt

s, alt = flags(day_ms, off_ms)
low = (alt > 0) & (alt < 25)
obs = {'glare_0.3': int((s >= 0.3).sum()), 'glare_0.6': int((s >= 0.6).sum()), 'low_sun': int(low.sum())}
log['observed'] = obs
log['daylight_crashes'] = int((alt > 0).sum())

# null: shuffle the dates among crashes that share the same clock hour (keeps time of day, place, road, and the seasonal mix of that hour)
N = 2000; sims = {k: np.zeros(N) for k in obs}
groups = [np.where(hour == h)[0] for h in range(24)]
for n in range(N):
    perm = np.arange(len(d))
    for g in groups:
        if len(g) > 1: perm[g] = rng.permutation(g)
    s2, alt2 = flags(day_ms[perm], off_ms[perm])
    sims['glare_0.3'][n] = (s2 >= 0.3).sum(); sims['glare_0.6'][n] = (s2 >= 0.6).sum(); sims['low_sun'][n] = ((alt2 > 0) & (alt2 < 25)).sum()
res = {}
for k in obs:
    e = sims[k].mean(); lo, hi = np.percentile(sims[k], [2.5, 97.5])
    res[k] = {'observed': obs[k], 'expected': round(float(e), 1), 'ratio': round(obs[k] / e, 3), 'null_95pct': [float(lo), float(hi)],
              'ratio_95pct': [round(obs[k] / hi, 3), round(obs[k] / lo, 3)], 'p_one_sided': float(((sims[k] >= obs[k]).sum() + 1) / (N + 1))}
log['shuffle_test'] = res

# simpler view: among crashes with a low sun, how often is the road lined up with the sun, vs the same roads with unrelated sun directions
az_now, _ = sun(day_ms + mins * 60000 - off_ms, lat, lng)
dd = np.abs((ax - az_now + 90) % 180 - 90)
aligned = int((dd[low] < 30).sum()); nlow = int(low.sum())
log['low_sun_alignment'] = {'low_sun_crashes': nlow, 'aligned_within_30deg': aligned, 'share': round(aligned / nlow, 4), 'share_if_road_direction_were_unrelated': round(60 / 180, 4)}
inj = (d.Number_Injured.values + d.Number_Killed.values) > 0
log['injury_subset'] = {'crashes': int(inj.sum()), 'glare_0.3_observed': int(((s >= 0.3) & inj).sum())}
log['years'] = [str(dates.min())[:10], str(dates.max())[:10]]
json.dump(log, open(sys.argv[2], 'w'), indent=1); print(json.dumps(log, indent=1))
