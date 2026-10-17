import importlib.util, io, json, pathlib, urllib.error
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('selection',HERE/'select-history.py');selection=importlib.util.module_from_spec(spec);spec.loader.exec_module(selection)
buyers=[{'id':i,'kod':str(i),'name':name,'state':1} for i,name in [(900005,'НЕВА'),(900004,'ПРОМТЕХСБЫТ'),(900003,'Empty'),(900002,'Foreign'),(800001,'Real A'),(700001,'Real B')]]
class Kis:
    def __init__(self,empty=False): self.calls=[];self.empty=empty
    def call(self,path,**kw):
        assert kw=={'kis':True};self.calls.append(path)
        if path=='/payers':return [{k:v for k,v in p.items() if k!='state'} for p in buyers]
        if path.startswith('/payers/'):
            kid=int(path.split('/')[2]);p=next(p for p in buyers if p['id']==kid)
            if '/orders?' in path:
                raise RuntimeError('HTTP 400: query attributes do not belong to order')
            if path.endswith('/orders'):
                return {'Id_pay':kid,'Orders':[] if self.empty or kid==900003 else [{'id':kid+1}]}
            if path.endswith('/clients'):return [self.point(kid)]
            return p
        if path.startswith('/clients/'):
            cid=int(path.split('/')[2]);kid=cid-10
            if path.endswith('/orders'):return {'id_clt':cid,'Orders':[{'id':kid+1}]}
            if '/matrix?' in path:return [{'id_prd':66,'cenaotp':34.9}]
            return self.point(kid)
        if path.startswith('/orders/'):
            oid=int(path.split('/')[2]);kid=oid-1
            return {'id':oid,'client_id':kid+10,'products':[{'id':66,'product_kod':'1263','product_name':'Bread','kol_sht':8,'cena_otp':34.9,'sum_all':279.2}]}
        raise AssertionError(path)
    def point(self,kid):return {'id':kid+10,'payer_id':1 if kid==900002 else kid,'kod':'C'+str(kid),'name':'Point','state':1}
api=Kis();chosen=selection.select(api,emit=lambda _:None)
assert [x['payer']['id'] for x in chosen]==[800001,700001]
assert all(x['history_count']==1 and x['stamp']>0 and x['group']==1 for x in chosen)
assert not any('/900005/' in p or '/900004/' in p for p in api.calls)
saved={'history':{'version':1,'proofs':[{'payer_kid':x['payer']['id'],'client':x['point']['id']} for x in chosen]}}
again=selection.select(api,saved,emit=lambda _:None);assert [x['point']['id'] for x in again]==[800011,700011]
try:selection.select(Kis(empty=True),emit=lambda _:None);raise AssertionError('Empty scenarios must fail before writes')
except RuntimeError as e:assert 'HISTORY_SCENARIOS_NOT_FOUND' in str(e) and 'empty buyer histories=4' in str(e)
print('PASS: selection skips banned/empty/foreign buyers, verifies history+details+matrix, reuses saved scenarios, fails closed on empty KIS; all requests read-only.')

class BadOwner(Kis):
    def call(self,path,**kw):
        value=super().call(path,**kw)
        if path.startswith('/payers/') and path.endswith('/orders'):value['Id_pay']=1
        return value
try:selection.select(BadOwner(),emit=lambda _:None);raise AssertionError('Foreign owner wrapper accepted')
except RuntimeError as e:assert 'HISTORY_SCENARIOS_NOT_FOUND' in str(e)
class BrokenRoute(Kis):
    def call(self,path,**kw):
        if path.startswith('/payers/') and path.endswith('/orders'):
            self.calls.append(path)
            raise RuntimeError('HTTP 400 at documented order route')
        return super().call(path,**kw)
api=BrokenRoute()
try:selection.select(api,emit=lambda _:None);raise AssertionError('Expected contract failure')
except RuntimeError:assert sum(p.startswith('/payers/') and p.endswith('/orders') for p in api.calls)==3
class FlatOrders(Kis):
    def call(self,path,**kw):
        value=super().call(path,**kw)
        if path.endswith('/orders'):return value['Orders']
        return value
api=FlatOrders();chosen=selection.select(api,emit=lambda _:None)
assert [x['payer']['id'] for x in chosen]==[800001,700001]
assert not any('/orders?' in path for path in api.calls)
assert selection.order_rows(FlatOrders(empty=True),'/payers/900003/orders','Id_pay',900003)==[]
print('PASS: VM-confirmed bare payer history route, flat empty/nonempty arrays, owner-checked wrappers, foreign-owner rejection, three-error stop.')

seed_spec=importlib.util.spec_from_file_location('seed',HERE.parent/'scripts/Seed-Demo-Users.py');seed=importlib.util.module_from_spec(seed_spec);seed_spec.loader.exec_module(seed)
class Transport:
    def __init__(self,doc,status=200):self.doc=doc;self.status=status
    def open(self,request,timeout):
        assert request.get_method()=='GET' and not request.has_header('Authorization')
        assert '?' not in request.full_url
        raw=io.BytesIO(json.dumps(self.doc).encode())
        if self.status>=400:raise urllib.error.HTTPError(request.full_url,self.status,'Bad Request',{},raw)
        return raw
api=seed.Api();api.token='local-pb-token-never-forwarded';api.opener=Transport({'success':True,'data':[]})
assert api.call('/payers/428125/orders',kis=True)==[]
api.opener=Transport({'success':False,'error':{'message':'Attribute id_pay\r\n does not belong to order','details':'private-oracle-stack'}},400)
try:api.call('/payers/428125/orders',kis=True);raise AssertionError('HTTP error swallowed')
except seed.Failure as e:
    assert 'HTTP 400' in str(e) and 'KIS: Attribute id_pay does not belong to order' in str(e)
    assert 'private-oracle-stack' not in str(e) and 'local-pb-token' not in str(e) and 'Повторите' not in str(e)
api.opener=Transport({'success':False,'error':'invalid-shape'},500)
try:api.call('/payers/428125/orders',kis=True);raise AssertionError('HTTP error swallowed')
except seed.Failure as e:assert str(e)=='HTTP 500 при /payers/428125/orders'
print('PASS: captured HTTP 200 empty JSON through actual KIS reader; upstream HTTP error message retained, SQL details/auth token excluded.')
