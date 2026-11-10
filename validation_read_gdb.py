"""Minimal reader for an Esri file geodatabase table (.gdbtable + .gdbtablx). Usage: gdb.py <table.gdbtable> <out.csv>"""
import struct, sys, csv, datetime

def varuint(b, p):
    v = 0; s = 0
    while True:
        c = b[p]; p += 1
        v |= (c & 0x7F) << s; s += 7
        if not c & 0x80: return v, p

def read_fields(b):
    nrows, = struct.unpack_from('<i', b, 4)
    foff, = struct.unpack_from('<q', b, 32)
    hsize, ver = struct.unpack_from('<ii', b, foff)
    nfields, = struct.unpack_from('<h', b, foff + 12); lay = b[foff + 8]
    p = foff + 14; fields = []
    for _ in range(nfields):
        n = b[p]; p += 1; name = b[p:p + 2 * n].decode('utf-16-le'); p += 2 * n
        n = b[p]; p += 1; p += 2 * n
        t = b[p]; p += 1; nullable = True
        if t == 4:
            p += 4; flag = b[p]; p += 1; ln, p = varuint(b, p); p += ln; nullable = bool(flag & 1)
        elif t == 6:
            p += 2; nullable = False
        elif t == 7:
            p += 1; flag = b[p]; p += 1; nullable = bool(flag & 1)
            ln, = struct.unpack_from('<h', b, p); p += 2 + ln
            mz = b[p]; p += 1; has_m = bool(mz & 2); has_z = bool(mz & 4)
            p += 24
            if has_m: p += 16
            if has_z: p += 16
            p += 8
            if has_m: p += 8
            if has_z: p += 8
            p += 32
            if lay & 0x80: p += 16
            if lay & 0x40: p += 16
            p += 1; ng, = struct.unpack_from('<i', b, p); p += 4 + 8 * ng
        elif t in (10, 11, 12, 8, 9):
            p += 1; flag = b[p]; p += 1; nullable = bool(flag & 1)
            if t == 9: raise SystemExit('raster field not supported')
        else:
            p += 1; flag = b[p]; p += 1; ln = b[p]; p += 1 + ln; nullable = bool(flag & 1)
        fields.append((name, t, nullable))
    return nrows, fields, foff + 4 + hsize

def rows(b, x, fields):
    n1024, nrow, osz = struct.unpack_from('<iii', x, 4)
    nn = [f for f in fields if f[2]]
    nb = (len(nn) + 7) // 8
    for i in range(n1024 * 1024):
        q = 16 + i * osz
        if q + osz > len(x): break
        off = int.from_bytes(x[q:q + osz], 'little')
        if not off: continue
        ln, = struct.unpack_from('<i', b, off)
        if ln <= 0: continue
        p = off + 4; nulls = b[p:p + nb]; p += nb; k = 0; rec = {'OBJECTID': i + 1}
        for name, t, nullable in fields:
            if t == 6: continue
            if nullable:
                isnull = nulls[k >> 3] >> (k & 7) & 1; k += 1
                if isnull: rec[name] = None; continue
            if t == 0: rec[name], = struct.unpack_from('<h', b, p); p += 2
            elif t == 1: rec[name], = struct.unpack_from('<i', b, p); p += 4
            elif t == 2: rec[name], = struct.unpack_from('<f', b, p); p += 4
            elif t == 3: rec[name], = struct.unpack_from('<d', b, p); p += 8
            elif t == 5:
                d, = struct.unpack_from('<d', b, p); p += 8
                rec[name] = (datetime.datetime(1899, 12, 30) + datetime.timedelta(days=d)).isoformat(sep=' ')
            elif t in (4, 12):
                ln2, p = varuint(b, p); rec[name] = b[p:p + ln2].decode('utf-8', 'replace'); p += ln2
            elif t in (7, 8):
                ln2, p = varuint(b, p); p += ln2; rec[name] = ''
            elif t in (10, 11): p += 16; rec[name] = ''
        yield rec

if __name__ == '__main__':
    b = open(sys.argv[1], 'rb').read(); x = open(sys.argv[1][:-9] + '.gdbtablx', 'rb').read()
    nrows, fields, _ = read_fields(b)
    print('declared rows', nrows); print([(f[0], f[1], f[2]) for f in fields])
    names = ['OBJECTID'] + [f[0] for f in fields if f[1] not in (6, 7)]
    n = 0
    with open(sys.argv[2], 'w', newline='') as fh:
        w = csv.DictWriter(fh, names, extrasaction='ignore'); w.writeheader()
        for r in rows(b, x, fields): w.writerow(r); n += 1
    print('rows written', n)
