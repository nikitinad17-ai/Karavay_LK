import {describe,expect,it} from 'vitest';
import {repeatPlan} from '../src/classic/repeatOrder';
import type {Item,Product} from '../src/classic/api';
const item=(quantity:number,change:Partial<Item>={}):Item=>({id:700,code:'001263',name:'Хлеб из истории',quantity,price:90,sum:quantity*90,...change});
const product=(change:Partial<Product>={}):Product=>({id:66,kod:'001263',name:'Хлеб из прайса',kol_sht:8,kolshtordmin:0,cenaotp:34.9,basecenaotp:null,procskd:null,weight:null,shelf_life:null,...change});
describe('Repeat an existing order using the current matrix',()=>{
 it('matches by exact product code and uses the current product ID and packing without mutating inputs',()=>{
  const items=[item(15)],products=[product({kol_sht:6})],before=structuredClone({items,products});
  const p=repeatPlan(items,products);expect(p.cart).toEqual({66:{lots:2,pcs:3}});expect(p.units).toBe(15);expect(p.count).toBe(1);expect(p.skipped).toEqual([]);expect({items,products}).toEqual(before);
 });
 it('combines duplicate historical lines, preserves pieces-only products and ignores zero quantities',()=>{
  const p=repeatPlan([item(3),item(5,{id:701}),item(0)],[product({kol_sht:null})]);expect(p.cart).toEqual({66:{lots:0,pcs:8}});expect(p.count).toBe(1);
 });
 it('preserves exact whole trays and never rounds a historical quantity to new packing',()=>{
  expect(repeatPlan([item(16)],[product({kolshtordmin:null})]).cart).toEqual({66:{lots:2,pcs:0}});
  const p=repeatPlan([item(16)],[product({kol_sht:10,kolshtordmin:null})]);expect(p.cart).toEqual({});expect(p.skipped[0].quantity).toBe(16);expect(p.skipped[0].reason).toContain('по 10');
 });
 it('keeps a changed minimum visible without changing the original quantity',()=>{
  const p=repeatPlan([item(3)],[product({kolshtordmin:4})]);expect(p.cart).toEqual({66:{lots:0,pcs:3}});expect(p.warnings[0].reason).toContain('4');
 });
 it('reports missing, unpriced, ambiguous and unknown-packing lines instead of silently dropping them',()=>{
  for(const products of [[],[product({cenaotp:null})],[product(),product({id:67})],[product({kolshtordmin:null,kol_sht:null})]]){
   const p=repeatPlan([item(8)],products);expect(p.count).toBe(0);expect(p.skipped).toHaveLength(1);expect(p.skipped[0].reason).not.toBe('');
  }
  expect(repeatPlan([item(8,{code:''})],[product()]).skipped[0].reason).toContain('код');
 });
 it('rejects corrupt quantities and blocks totals above the server limit',()=>{
  expect(()=>repeatPlan([item(1.5)],[product()])).toThrow();
  expect(repeatPlan([item(1000000),item(1,{id:701})],[product()]).skipped[0].reason).toContain('превышает');
 });
});
