import importlib.util, pathlib
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
            if '/orders?' in path:return [] if self.empty or kid==900003 else [{'id':kid+1}]
            if path.endswith('/clients'):return [self.point(kid)]
            return p
        if path.startswith('/clients/'):
            cid=int(path.split('/')[2]);kid=cid-10
            if path.endswith('/orders'):return [{'id':kid+1}]
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
