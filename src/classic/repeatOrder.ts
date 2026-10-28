import {lotOnly,quantityError,validId} from './api';
import type {Item,Product} from './api';

export type Cart = Record<number,{lots:number;pcs:number}>;
export interface RepeatIssue {code:string;name:string;quantity:number;reason:string}
export interface RepeatPlan {cart:Cart;skipped:RepeatIssue[];warnings:RepeatIssue[];count:number;units:number}

/** Match the KIS product code, then use the CURRENT matrix ID, price and packing.
 * Historical line IDs and prices are not a source for a new submission.
 */
export function repeatPlan(items:Item[],products:Product[]):RepeatPlan {
 const grouped=new Map<string,{name:string;quantity:number}>();
 for(const item of items){
  if(!Number.isSafeInteger(item.quantity)||item.quantity<0)throw new Error('Invalid historical quantity');
  if(item.quantity===0)continue;
  const code=item.code.trim(),old=grouped.get(code);
  grouped.set(code,{name:old?.name||item.name,quantity:(old?.quantity||0)+item.quantity});
 }
 const result:RepeatPlan={cart:{},skipped:[],warnings:[],count:0,units:0};
 for(const [code,line] of grouped){
  const matches=products.filter(p=>typeof p.kod==='string'&&p.kod.trim()===code);
  const p=matches.length===1?matches[0]:undefined;
  let reason=!code?'В истории не указан код товара.':!matches.length?'Нет в прайсе на выбранную дату и группу.':matches.length>1?'Код неоднозначен в текущем прайсе.':'';
  if(!Number.isSafeInteger(line.quantity)||line.quantity>1000000)reason='Количество превышает допустимое значение.';
  if(p&&!reason){
   if(p.cenaotp===null)reason='В текущем прайсе не указана цена.';
   else if(lotOnly(p)&&(!validId(p.kol_sht)||line.quantity%p.kol_sht!==0))reason=quantityError(p,line.quantity);
  }
  const issue={code,name:line.name,quantity:line.quantity,reason};
  if(reason||!p){result.skipped.push(issue);continue;}
  const packing=validId(p.kol_sht)?p.kol_sht:0;
  result.cart[p.id]=packing?{lots:Math.floor(line.quantity/packing),pcs:line.quantity%packing}:{lots:0,pcs:line.quantity};
  const warning=quantityError(p,line.quantity);
  if(warning)result.warnings.push({...issue,reason:warning});
  result.count++;result.units+=line.quantity;
 }
 return result;
}
