#!/usr/bin/env python3
"""Read-only KIS contract capture. No credentials, database edits or order writes."""
import json, re, urllib.request, urllib.error, urllib.parse, zipfile
from pathlib import Path
BASE = 'http://serv15db:55580'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
files, status = {}, []
def get(path, name):
    try:
        with opener.open(BASE + path, timeout=20) as r:
            body = r.read(8*1024*1024+1)
            if len(body)>8*1024*1024: raise ValueError('response too large')
            files[name] = body
            status.append({'path':path,'status':r.status,'bytes':len(body)})
            return body.decode('utf-8')
    except Exception as e:
        status.append({'path':path,'error':type(e).__name__,'http':getattr(e,'code',None)})
        return ''
def parse(s):
    # Fix Oracle-style decimals only outside quoted strings.
    parts=re.split(r'("(?:\\.|[^"\\])*")',s)
    for i in range(0,len(parts),2): parts[i]=re.sub(r'([:\[,]\s*)(-?)\.(\d)',r'\g<1>\g<2>0.\3',parts[i])
    return json.loads(''.join(parts))
scalar=get('/scalar/v1','scalar.html')
paths=['/openapi/v1.json','/swagger/v1/swagger.json']
for candidate in re.findall(r'["\']([^"\']+(?:\.json|\.yaml|\.yml))["\']',scalar):
    u=urllib.parse.urlsplit(urllib.parse.urljoin(BASE+'/scalar/v1',candidate))
    if u.scheme=='http' and u.netloc=='serv15db:55580' and u.path.startswith('/'):
        paths.insert(0,u.path+('?' + u.query if u.query else ''))
for i,path in enumerate(dict.fromkeys(paths)):
    raw=get(path,'schema-candidate-'+str(i)+'.txt')
    try:
        doc=parse(raw)
        if isinstance(doc,dict) and ('openapi' in doc or 'swagger' in doc):
            files['openapi.json']=json.dumps(doc,ensure_ascii=False,indent=2).encode();break
    except Exception: pass
for pid,cid in [(300182,300183),(299271,299300)]:
    get('/api/v1/payers/'+str(pid),'payer-'+str(pid)+'.json')
    get('/api/v1/payers/'+str(pid)+'/clients','payer-'+str(pid)+'-clients.json')
    get('/api/v1/clients/'+str(cid),'client-'+str(cid)+'.json')
    raw=get('/api/v1/clients/'+str(cid)+'/orders','client-'+str(cid)+'-orders.json')
    try:
        doc=parse(raw); rows=doc.get('data') if isinstance(doc,dict) else doc
        if isinstance(rows,list):
            for order in rows[:2]:
                oid=order.get('id')
                if type(oid) is int and oid>0: get('/api/v1/orders/'+str(oid),'order-'+str(oid)+'.json')
    except Exception: pass
files['capture-status.json']=json.dumps(status,ensure_ascii=False,indent=2).encode()
out=Path.home()/'Karavay-Order-Contract-20261014.zip'
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    for name,data in files.items(): z.writestr(name,data)
print('CONTRACT_CAPTURED:',out)
print('OpenAPI:', 'found' if 'openapi.json' in files else 'not found; scalar and response samples saved')
print('Only GET requests were sent. No orders or users were created.')
