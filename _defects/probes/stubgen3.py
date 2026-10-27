import sys
src = open(sys.argv[1]).read()
names = set(sys.argv[2].split(','))
out_path = sys.argv[3]
lines = src.split('\n')
starts = [i for i, l in enumerate(lines) if l.startswith('fn ')]
starts.append(len(lines))
def stub_body(sig):
    if '-> void' in sig: return ['}']
    if '-> bool' in sig: return ['    return false;', '}']
    if '-> ptr' in sig: return ['    return PTR_NULL();', '}']
    return ['    return 0;', '}']
def depth_delta(line, in_str_state):
    d = 0
    i = 0
    in_str = in_str_state
    while i < len(line):
        c = line[i]
        if in_str:
            if c == '\\': i += 2; continue
            if c == '"': in_str = False
            i += 1; continue
        if c == '"':
            in_str = True; i += 1; continue
        if c == '/' and i + 1 < len(line) and line[i+1] == '/':
            break
        if c == '{': d += 1
        elif c == '}': d -= 1
        i += 1
    return d, in_str
out = lines[:starts[0]]
for k in range(len(starts) - 1):
    i = starts[k]
    seg = lines[i:starts[k+1]]
    sig = seg[0]
    name = sig.split('(')[0][3:].strip()
    if name not in names:
        out.extend(seg); continue
    # find fn end: brace depth returns to 0
    depth = 0; in_str = False; close = None
    for j, l in enumerate(seg):
        dd, in_str = depth_delta(l, in_str)
        depth += dd
        if j > 0 and depth == 0:
            close = j; break
    if close is None:
        out.extend(seg); continue
    out.append(sig)
    out.extend(stub_body(sig))
    out.extend(seg[close+1:])
open(out_path, 'w').write('\n'.join(out))
print('stubbed:', ','.join(sorted(names)))
