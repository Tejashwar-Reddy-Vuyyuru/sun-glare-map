"""Extra checks for the crash validation: placebo, morning/evening, injury crashes.
Usage: validation_extra_checks.py <crashes.csv>"""
import sys, os, numpy as np
# reuse the main script's prepared arrays by running it with a tiny shuffle count
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'validation_crash_check.py')).read().replace('N = 2000;', 'N = 2;').replace("json.dump(log, open(sys.argv[2], 'w'), indent=1); print(json.dumps(log, indent=1))", '')
g = {'__name__': 'x'}; sys.argv = ['x', sys.argv[1], '/dev/null']; exec(compile(src, 'analyse', 'exec'), g)
sun, score, day_ms, off_ms, mins, hour, lat, lng, ax, groups, rng = (g[k] for k in ['sun','score','day_ms','off_ms','mins','hour','lat','lng','ax','groups','rng'])
def run(axis, mask, N=600, thr=0.6):
    az, alt = sun(day_ms + mins*60000 - off_ms, lat, lng); obs = int(((score(axis, az, alt) >= thr) & mask).sum()); sims = []
    for n in range(N):
        perm = np.arange(len(ax))
        for gr in groups:
            if len(gr) > 1: perm[gr] = rng.permutation(gr)
        az2, alt2 = sun(day_ms[perm] + mins*60000 - off_ms[perm], lat, lng); sims.append(((score(axis, az2, alt2) >= thr) & mask).sum())
    sims = np.array(sims); return obs, round(float(sims.mean()), 1), round(obs / sims.mean(), 3), float(((sims >= obs).sum() + 1) / (N + 1))
allm = np.ones(len(ax), bool)
print('real roads, strong glare      ', run(ax, allm))
print('placebo: roads turned 90 deg  ', run((ax + 90) % 180, allm))
print('morning only (before noon)    ', run(ax, hour < 12))
print('afternoon/evening only        ', run(ax, hour >= 12))
inj = g['inj']
print('injury or fatal crashes only  ', run(ax, inj))
print('medium+ glare, real roads     ', run(ax, allm, thr=0.3))
print('medium+ glare, placebo 90 deg ', run((ax + 90) % 180, allm, thr=0.3))
