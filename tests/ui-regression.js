// Изолированные проверки логики интерфейса. Не заменяют проверку в браузере:
// DOM ниже моделирует события, замену узлов, фокус и координаты без layout engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('✓ ' + name); }

function setup() {
  const listeners = {}, nodes = new Map(), requests = [];
  let renders = 0;
  const document = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    querySelector(sel) { return nodes.get(sel) || null; },
    querySelectorAll(sel) { return nodes.has(sel) ? [nodes.get(sel)] : []; },
    getElementById(id) { return nodes.get('#' + id) || null; }
  };
  function node(tag = 'div', attrs = {}, parent = null) {
    const children = [], classes = new Set((attrs.class || '').split(' ').filter(Boolean));
    const el = {
      tagName: tag.toUpperCase(), id: attrs.id || '', parentElement: parent, children,
      scrollTop: 0, scrollLeft: 0, value: '', style: {}, hidden: false,
      selectionStart: null, selectionEnd: null,
      hasAttribute(a) { return Object.hasOwn(attrs, a); },
      getAttribute(a) { return attrs[a] ?? null; },
      matches(selector) {
        return selector.split(',').some(s => {
          s = s.trim();
          if (s.includes(' > ') || s.includes(' ')) return false;
          if (s.includes(':not')) return false;
          const name = s.match(/^[a-z]+/i)?.[0];
          if (name && name.toUpperCase() !== el.tagName) return false;
          for (const c of s.matchAll(/\.([\w-]+)/g)) if (!classes.has(c[1])) return false;
          for (const a of s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
            if (!el.hasAttribute(a[1]) || (a[2] !== undefined && el.getAttribute(a[1]) !== a[2])) return false;
          }
          return true;
        });
      },
      closest(selector) { return el.matches(selector) ? el : parent?.closest(selector) || null; },
      querySelector(selector) { return children.find(c => c.matches(selector)) || null; },
      querySelectorAll() { return children; },
      contains(other) { return other === el || children.some(c => c.contains(other)); },
      focus(options) { document.activeElement = el; el.focusOptions = options; },
      setSelectionRange(a, b) { el.selectionStart = a; el.selectionEnd = b; },
      click() { dispatch('click', el); },
      getClientRects() { return el.hidden ? [] : [{}]; },
      classList: {
        contains(c) { return classes.has(c); },
        remove(c) { classes.delete(c); },
        toggle(c, value = !classes.has(c)) { value ? classes.add(c) : classes.delete(c); return value; }
      }
    };
    parent?.children.push(el);
    return el;
  }
  document.body = node('body'); document.documentElement = node('html');
  document.activeElement = document.body;
  const window = {scrollX: 0, scrollY: 0, scrollTo({left, top}) { this.scrollX = left; this.scrollY = top; }};
  const context = vm.createContext({ document, window, CSS: {escape: s => String(s)}, console,
    setTimeout() {}, clearTimeout() {}, URLSearchParams,
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({url, options, resolve, reject})); }
  });
  const exports = `globalThis.test = { state, render, captureUi, uiLocator, orderReviewData,
    viewOrderReview, viewOrder, viewMobileReview, viewShell, viewOrders, viewProfile, viewOutlets,
    viewDocuments, viewDashboard, snapshotOrder, orderChanged, orderItemLots, orderItemPcs, toast,
    setRender(fn){render=fn}, resetRender(){render=this.render},
    simpleViews(){viewDashboard=viewOrder=viewOrders=viewDocuments=viewProfile=viewOutlets=()=>'<main>test</main>'; viewShell=x=>x;}
  };})();`;
  vm.runInContext(source.split('// ================ INIT ================')[0] + exports, context);
  const api = context.test, s = api.state;
  api.setRender(() => renders++);
  Object.assign(s, {
    buyer: {id:1, name:'Покупатель', code:'B-1', minOrderSum:0, manager:'Менеджер'}, role:'buyer',
    outlets:[{id:1,id_clt:51,name:'Точка 1',code:'M-1',address:'Адрес 1',minOrderSum:100}],
    currentOutletId:1, route:'order', orderReady:true, orderDate:'2026-09-10',
    products:[{id:1,code:'P-1',name:'Хлеб',price:25.5,piecesPerLot:10,category:'Хлеб'},
      {id:2,code:'P-2',name:'Булка',price:50,piecesPerLot:5,category:'Булки'},
      {id:3,code:'P-3',name:'Не выбран',price:75,category:'Хлеб'}],
    cart:{1:10,2:3}
  });
  function dispatch(type, target, extra = {}) {
    const e = {target, preventDefault() {this.prevented = true;}, ...extra};
    for (const fn of listeners[type] || []) fn(e);
    return e;
  }
  function action(name, attrs = {}, parent = null) { return node('button', {'data-action':name,...attrs}, parent); }
  return {api,s,node,nodes,document,window,requests,dispatch,action,get renders(){return renders;}};
}

async function main() {
  const h = setup(), {api,s,node,nodes,dispatch,action} = h;
  for(const view of ['viewDashboard','viewOrder','viewOrders','viewDocuments','viewProfile','viewOutlets']) {
    check('Сборка разметки раздела без ошибок: '+view, () => {
      assert.ok(api.viewShell(api[view]()).includes('sidebar__nav'));
    });
  }
  check('Проверка содержит только выбранные товары, получателя, дату, количества и суммы', () => {
    const html = api.viewOrderReview();
    for (const text of ['Хлеб','Булка','Точка 1','Адрес 1','10 шт.','3 шт.','405,00','сентября']) assert.ok(html.includes(text), text);
    assert.ok(!html.includes('Не выбран'));
    assert.equal(api.orderReviewData().units,13);
  });
  check('На первом шаге нет формы отправки; обе кнопки ведут к проверке', () => {
    assert.ok(!api.viewOrder().includes('data-form="order"'));
    assert.ok(api.viewOrder().includes('Проверить заказ'));
    assert.ok(api.viewMobileReview().includes('data-action="review-order"'));
  });
  check('Открытие проверки и возврат сохраняют корзину, поиск и фильтр', () => {
    s.productSearch='хлеб'; s.filter='promo';
    const before=JSON.stringify(s.cart);
    dispatch('click',action('review-order')); assert.equal(s.reviewOpen,true);
    dispatch('click',action('close-review')); assert.equal(s.reviewOpen,false);
    assert.equal(JSON.stringify(s.cart),before); assert.equal(s.productSearch,'хлеб'); assert.equal(s.filter,'promo');
  });
  check('Минимальная сумма проверяется при отправке, но не мешает посмотреть состав', () => {
    s.cart={1:1}; assert.equal(api.orderReviewData().canReview,true);
    assert.equal(api.orderReviewData().canSubmit,false);
    assert.ok(api.viewOrderReview().includes('До минимальной суммы'));
    s.cart={1:10,2:3};
  });
  for (const mode of ['empty','unknown','zero','fraction','loading','error']) {
    check('Нельзя отправить некорректный заказ: '+mode, () => {
      const before={...s.cart};
      if(mode==='empty') s.cart={};
      if(mode==='unknown') s.cart[999]=2;
      if(mode==='zero') s.cart[1]=0;
      if(mode==='fraction') s.cart[1]=1.2;
      if(mode==='loading') s.matrixLoading=true;
      if(mode==='error') s.matrixError='Ошибка';
      assert.equal(api.orderReviewData().canSubmit,false);
      s.cart=before;s.matrixLoading=false;s.matrixError=null;
    });
  }
  const order={id:77,orderNumber:77,state:'Принят',status:'accepted',items:[{code:'P-1',price:25.5,qty:10,sum:255,piecesPerLot:10}],total:255,totalUnits:10};
  s.ordersAll=[order];s.modalOrder=order;s.editSnapshot=api.snapshotOrder(order);
  const backdrop=node('div',{'data-action':'close-modal',class:'modal-back'});
  const modal=node('div',{class:'modal','data-stop':''},backdrop);
  for (const tag of ['div','input','td','span','h3']) {
    check('Клик внутри карточки не закрывает её: '+tag, () => {
      const count=h.renders;
      dispatch('click',node(tag,{},modal));
      assert.equal(s.modalOrder,order);assert.equal(s.confirm,null);assert.equal(h.renders,count);
    });
  }
  check('Прямой ввод количества обновляет сумму и кнопку сохранения без перерисовки', () => {
    const wrap=node('div',{'data-order-item':'','data-order':'77','data-item':'P-1'},modal);
    const lots=node('input',{'data-oi-lots-input':''},wrap); lots.value='2';
    const pcs=node('input',{'data-oi-pcs-input':''},wrap); pcs.value='15';
    const total=node('div',{'data-oi-total':''},wrap);
    const money=node(),save=node(),repeat=node();
    nodes.set('[data-order-total]',money);nodes.set('.modal [data-action="save-order-edits"]',save);nodes.set('.modal [data-action="repeat-order"]',repeat);
    const count=h.renders;dispatch('input',pcs);
    assert.equal(order.items[0].qty,35);assert.equal(order.total,892.5);assert.equal(total.textContent,35);
    assert.equal(api.orderItemLots(order.items[0]),2);assert.equal(api.orderItemPcs(order.items[0]),15);
    assert.equal(save.hidden,false);assert.equal(repeat.hidden,true);assert.equal(h.renders,count);
    pcs.value='16';dispatch('input',pcs);assert.equal(order.items[0].qty,36);
  });
  check('Закрытие изменённого заказа требует явного решения', () => {
    dispatch('click',action('close-modal')); assert.ok(s.confirm); assert.equal(s.modalOrder,order);
  });
  check('Клик внутри подтверждения ничего не выполняет', () => {
    const cb=node('div',{'data-action':'confirm-back',class:'confirm-back'});
    dispatch('click',node('div',{},cb));assert.ok(s.confirm);
  });
  check('Клик по фону подтверждения сохраняет правки и открытую карточку', () => {
    dispatch('click',node('div',{'data-action':'confirm-back',class:'confirm-back'}));
    assert.equal(s.confirm,null);assert.equal(s.modalOrder,order);assert.equal(order.items[0].qty,36);
  });
  check('Escape в подтверждении сохраняет правки', () => {
    dispatch('click',action('close-modal'));dispatch('keydown',node(),{key:'Escape'});
    assert.equal(s.confirm,null);assert.equal(order.items[0].qty,36);
  });
  check('Только явная «Отменить правки» откатывает количество', () => {
    dispatch('click',action('close-modal'));dispatch('click',action('confirm-cancel'));
    assert.equal(s.modalOrder,null);assert.equal(order.items[0].qty,10);
  });
  check('Клик по фону неизменённой карточки закрывает её', () => {
    s.modalOrder=order;s.editSnapshot=api.snapshotOrder(order);dispatch('click',backdrop);assert.equal(s.modalOrder,null);
  });
  check('Меню закрывается по его фону; клик на пустой странице бездействует', () => {
    const sb=node('aside',{id:'sidebar'}), ov=node('div',{id:'sidebarOverlay'});
    nodes.set('#sidebar',sb);nodes.set('#sidebarOverlay',ov);
    dispatch('click',action('toggle-menu'));assert.equal(s.menuOpen,true);
    const count=h.renders; dispatch('click',node()); assert.equal(s.menuOpen,true);assert.equal(h.renders,count);
    dispatch('click',action('close-menu'));assert.equal(s.menuOpen,false);
  });
  check('Все пункты меню переключают ровно свой раздел и сохраняют корзину', () => {
    const cart=JSON.stringify(s.cart);
    for(const route of ['dashboard','order','orders','documents','profile','outlets']) {
      s.menuOpen=true;dispatch('click',node('a',{'data-route':route}));
      assert.equal(s.route,route);assert.equal(s.menuOpen,false);assert.equal(JSON.stringify(s.cart),cart);
    }
  });
  check('Клик по фону окна выхода не очищает корзину и не завершает сеанс', () => {
    dispatch('click',action('logout'));assert.ok(s.confirm);
    dispatch('click',node('div',{'data-action':'confirm-back',class:'confirm-back'}));
    assert.ok(s.buyer);assert.ok(Object.keys(s.cart).length);
  });
  // Настоящий render() поверх модели заменяемых DOM-узлов.
  const r=setup();r.api.simpleViews();r.api.resetRender();
  const root=r.node('div',{id:'root'});r.nodes.set('#root',root);
  Object.defineProperty(root,'innerHTML',{set(html){
    this.html=html;this.children.length=0;r.document.activeElement=r.document.body;
    for(const id of ['catalog','horizontal','field','reviewTitle']) {
      const el=r.node(id==='field'?'textarea':'div',{id},root);r.nodes.set('#'+id,el);
    }
  }});
  r.api.render();
  for(const route of ['order','orders','documents','profile','outlets','dashboard']) {
    check('Повторный render сохраняет вертикальный и горизонтальный скролл: '+route, () => {
      r.s.route=route;r.api.render();r.window.scrollY=640;
      r.nodes.get('#catalog').scrollTop=870;r.nodes.get('#horizontal').scrollLeft=125;
      const field=r.nodes.get('#field');field.value='текст';field.selectionStart=2;field.selectionEnd=3;field.focus();
      r.api.render();
      assert.equal(r.window.scrollY,640);assert.equal(r.nodes.get('#catalog').scrollTop,870);assert.equal(r.nodes.get('#horizontal').scrollLeft,125);
      assert.equal(r.document.activeElement,r.nodes.get('#field'));assert.equal(r.document.activeElement.focusOptions.preventScroll,true);
      assert.equal(r.document.activeElement.value,'текст');assert.equal(r.document.activeElement.selectionStart,2);
    });
  }
  check('Уведомление не закрывает мобильное меню и не сбрасывает прокрутку', () => {
    r.s.menuOpen=true;r.window.scrollY=500;r.api.toast('Тест');
    assert.equal(r.s.menuOpen,true);assert.equal(r.window.scrollY,500);
  });
  check('Новый раздел начинается сверху; повторный клик по текущему сохраняет положение', () => {
    r.s.route='profile';r.api.render();assert.equal(r.window.scrollY,0);
    r.window.scrollY=500;r.dispatch('click',r.node('a',{'data-route':'profile'}));assert.equal(r.window.scrollY,500);
  });
  check('Открытие и закрытие проверки сохраняют позицию каталога и возвращают фокус', () => {
    r.s.route='order';r.s.orderReady=true;r.api.render();
    r.nodes.get('#field').focus();r.window.scrollY=420;r.nodes.get('#catalog').scrollTop=600;
    r.s.reviewOpen=true;r.api.render();assert.equal(r.document.activeElement.id,'reviewTitle');
    r.s.reviewOpen=false;r.api.render();assert.equal(r.document.activeElement.id,'field');
    assert.equal(r.window.scrollY,420);assert.equal(r.nodes.get('#catalog').scrollTop,600);
  });
  const submit=setup(), form=submit.node('form');form.dataset={form:'order'};form.elements=[];
  check('Нельзя отправить заказ, минуя проверку', () => {
    submit.dispatch('submit',form);assert.equal(submit.requests.length,0);
  });
  check('Повторные нажатия отправляют только один запрос; окно занято до ответа', () => {
    submit.s.reviewOpen=true;submit.dispatch('submit',form);submit.dispatch('submit',form);
    assert.equal(submit.requests.length,1);assert.equal(submit.s.submittingOrder,true);
    submit.dispatch('click',submit.action('close-review'));assert.equal(submit.s.reviewOpen,true);
    submit.dispatch('keydown',submit.node(),{key:'Escape'});assert.equal(submit.s.reviewOpen,true);
  });
  submit.requests[0].reject({detail:'Нет связи'});await new Promise(setImmediate);
  check('Ошибка сохраняет окно проверки и корзину, разрешает повтор', () => {
    assert.equal(submit.s.reviewError,'Нет связи');assert.equal(submit.s.submittingOrder,false);
    assert.equal(submit.s.reviewOpen,true);assert.equal(submit.s.cart[1],10);
  });
  submit.dispatch('submit',form);
  submit.requests[1].resolve({ok:true,status:200,json:async()=>({Id_ord:88,NumOrd:88,State:'Принят',DateOrd:1788998400,SumAll:405,KolSht:13})});
  await new Promise(setImmediate);
  check('После успешной отправки открывается история и очищается только отправленная корзина', () => {
    assert.equal(submit.s.route,'orders');assert.equal(submit.s.reviewOpen,false);assert.equal(submit.s.submittingOrder,false);
    assert.equal(Object.keys(submit.s.cart).length,0);assert.equal(submit.s.ordersAll[0].id,88);
  });
  console.log('\nПройдено '+passed+' проверок логики. Визуальные проверки браузера выполняются отдельно.');
}
main().catch(err => {console.error(err);process.exitCode=1;});
