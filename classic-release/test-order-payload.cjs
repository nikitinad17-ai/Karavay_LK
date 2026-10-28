const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(__dirname+'/pb_hooks/karavay-checkout.js','utf8');
const sandbox={module:{exports:{}}};
vm.runInNewContext(source+'\nmodule.exports.payload=orderPayload;module.exports.validate=validate;',sandbox);
const draft=day=>({payer:'aaaaaaaaaaaaaaa',client:300183,DateOrd:Date.parse(day+'T00:00:00+03:00')/1000,Group:1,products:[{id:425162,quantity:3,price:10},{id:425163,quantity:6,price:20}]});
function payload(body){return JSON.parse(JSON.stringify(sandbox.module.exports.payload(sandbox.module.exports.validate(body))));}
test('developer request shape: recipient, local date and pieces; no prices or internal fields',()=>{
 assert.deepEqual(payload(draft('2026-10-30')),{client_id:300183,order_date:'2026-10-30T00:00:00',products:[{id:425162,kol_sht:3},{id:425163,kol_sht:6}]});
});
for(const day of ['2027-01-01','2028-02-29','2026-03-29','2026-10-25'])test('Moscow calendar date is retained: '+day,()=>{
 assert.equal(payload(draft(day)).order_date,day+'T00:00:00');
});
test('duplicate items and invalid quantities remain rejected before transport',()=>{
 for(const quantity of [0,-1,1.5])assert.throws(()=>payload({...draft('2026-10-30'),products:[{id:425162,quantity,price:10}]}));
 const body=draft('2026-10-30');body.products[1].id=body.products[0].id;assert.throws(()=>payload(body));
});
