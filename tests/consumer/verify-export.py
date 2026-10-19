"""Independent final-byte STORE consumer. Python stdlib plus the isolated ML-007 reader.
No src/editor/runtime imports. No untrusted path is extracted before the entire inventory passes.
Checks integrity/closure only; constructs no world and makes no engine/controller claim.
"""
import argparse, hashlib, io, json, pathlib, re, struct, subprocess, tempfile, zipfile
MAX = 512 * 1024 * 1024

def strict_json(raw):
    def pairs(items):
        d = {}
        for k, v in items:
            if k in d: raise ValueError('duplicate JSON key')
            d[k] = v
        return d
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite')))

def inventory(raw):
    if len(raw) < 22 or len(raw) >= MAX: raise ValueError('archive size')
    end = struct.unpack('<4s4H2LH', raw[-22:])
    if end[0] != b'PK\x05\x06' or end[1:3] != (0, 0) or end[3] != end[4] or not 0 < end[4] <= 20000 or end[5] + end[6] != len(raw)-22 or end[7]: raise ValueError('end record')
    files = {}; seen = set(); offset = 0; total = 0; previous = ''
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        infos = z.infolist()
        if len(infos) != end[4]: raise ValueError('file count')
        for i in infos:
            p = i.filename
            if not p or len(p) > 240 or len(p.split('/')) > 16 or p <= previous: raise ValueError('path order')
            previous = p
            for s in p.split('/'):
                if not re.fullmatch(r'[A-Za-z0-9_](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?', s) or re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', s, re.I): raise ValueError('path')
            if p.lower() in seen or re.search(r'\.(zip|jar|7z|rar|tar|gz|tgz|bz2|xz)$', p, re.I): raise ValueError('alias/archive')
            seen.add(p.lower())
            if i.compress_type != 0 or i.compress_size != i.file_size or i.date_time != (1980,1,1,0,0,0) or i.flag_bits != 0x800 or i.extra or i.comment or i.create_system != 0 or i.create_version != 20 or i.extract_version != 20 or i.external_attr or i.internal_attr or i.header_offset != offset: raise ValueError('STORE metadata')
            total += i.file_size
            if total >= MAX: raise ValueError('expansion')
            fields = struct.unpack_from('<4s5H3L2H', raw, offset)
            name = p.encode('ascii')
            if fields != (b'PK\x03\x04',20,0x800,0,0,33,i.CRC,i.file_size,i.file_size,len(name),0) or raw[offset+30:offset+30+len(name)] != name: raise ValueError('local header')
            offset += 30 + len(name) + i.file_size
            if offset > end[6]: raise ValueError('bounds')
            files[p] = z.read(i)
    if offset != end[6]: raise ValueError('unaccounted bytes')
    for p in seen:
        parts = p.split('/')
        if any('/'.join(parts[:n]) in seen for n in range(1,len(parts))): raise ValueError('directory alias')
    return files

def verify_files(files, args, trusted=None):
    if 'manifest.json' not in files: raise ValueError('manifest missing')
    manifest = strict_json(files['manifest.json'])
    if trusted and hashlib.sha256(files['manifest.json']).hexdigest() != trusted: raise ValueError('trusted digest')
    listed = manifest['files']; paths = [x['path'] for x in listed]
    if paths != sorted(set(paths)) or set(paths) != set(files)-{'manifest.json'}: raise ValueError('complete inventory')
    for f in listed:
        b = files[f['path']]
        if len(b) != f['bytes'] or hashlib.sha256(b).hexdigest() != f['sha256']: raise ValueError('length/digest')
    # Every filename was validated before these temporary writes. The Node reader additionally
    # checks pinned schemas, canonical JSON, contract negotiation and all cross-document references.
    with tempfile.TemporaryDirectory(prefix='maplab-independent-export-') as td:
        root = pathlib.Path(td)
        for p,b in files.items():
            dest = root/p
            dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(b)
        proc = subprocess.run([args.node,args.reader,'--schemas',args.schemas,str(root)], capture_output=True, text=True)
        if proc.returncode != 0: raise ValueError('independent closure: '+proc.stdout+proc.stderr)
        return json.loads(proc.stdout)

def repack(files):
    # Corruption fixtures intentionally use a regular ZIP; STORE metadata for these is tested
    # separately, while final-file mutations exercise the independent directory reader.
    b = io.BytesIO()
    with zipfile.ZipFile(b,'w',compression=zipfile.ZIP_STORED) as z:
        for p,v in sorted(files.items()): z.writestr(p,v)
    return b.getvalue()

def main():
    p=argparse.ArgumentParser();p.add_argument('--node',required=True);p.add_argument('--reader',required=True);p.add_argument('--schemas',required=True);p.add_argument('--expect-digest');p.add_argument('--self-test',action='store_true');p.add_argument('zip');args=p.parse_args()
    raw=pathlib.Path(args.zip).read_bytes(); files=inventory(raw); report=verify_files(files,args,args.expect_digest); negatives=[]
    if args.self_test:
        for case in ['path','size','unlisted','digest','missing-dependency','duplicate','zip-bomb','crc']:
            try:
                if case in ['path','duplicate','zip-bomb','crc']:
                    b=bytearray(raw); central=struct.unpack_from('<L',b,len(b)-6)[0]
                    if case=='path': b[central+46]=47
                    if case=='duplicate':
                        # A duplicate aliases by ASCII case, independent of the lexical check.
                        d=dict(files); d['MANIFEST.json']=files['manifest.json']; inventory(repack(d)); raise AssertionError('duplicate accepted')
                    if case=='zip-bomb': struct.pack_into('<L',b,central+24,0xffffffff)
                    if case=='crc': b[100]^=1
                    inventory(b)
                else:
                    d=dict(files); m=strict_json(d['manifest.json'])
                    if case=='size': m['files'][0]['bytes']+=1
                    if case=='digest': m['files'][0]['sha256']='0'*64
                    if case=='unlisted': d['unlisted.txt']=b'x'
                    if case=='missing-dependency':
                        del d['maps/clearing.map.json'];m['files']=[f for f in m['files'] if f['path']!='maps/clearing.map.json'];m['documents']=[f for f in m['documents'] if f['id']!='map.clearing']
                    d['manifest.json']=json.dumps(m,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
                    verify_files(d,args)
                raise AssertionError(case+' accepted')
            except (ValueError,zipfile.BadZipFile,KeyError): negatives.append(case)
    print(json.dumps(dict(ok=True,bundleSha256=hashlib.sha256(files['manifest.json']).hexdigest(),zipSha256=hashlib.sha256(raw).hexdigest(),zipBytes=len(raw),files=len(files),negativeCases=len(negatives),rejected=negatives,consumer=report),indent=2))
if __name__=='__main__': main()
