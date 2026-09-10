/* Демо-бэкенд v1.9: перехват fetch к /api/*
   Модель:
   - BUYERS (покупатели, юрлица-плательщики): hasContract, сальдо, shipmentMode, minOrderSum, мастер-пароль
   - OUTLETS (получатели/точки): ТП, телефон, minOrderSum, пароль точки
   v1.9: графики доставки и слоты убраны — дату назначает Каравай (маршрут).
   Все свойства контроля (hasContract, shipmentMode, minOrderSum, deliverySchedule) корректируются на стороне Каравая, в лк-е клиента — read-only.
   Логика блокировки отгрузки (по приоритету):
   1. hasContract=false → «Нет действующего договора»
   2. shipmentMode="blocked" → причина из shipmentBlockReason
   3. shipmentMode="balance" и balance<0 → «Отрицательное сальдо»
   4. иначе → отгрузка разрешена
   Логин:
   - код покупателя + пароль покупателя → доступ ко всем точкам
   - код точки + пароль покупателя → доступ ко всем точкам покупателя
   - код точки + пароль точки → доступ только к этой точке
*/
(function(){
  var PRODUCTS = window.__PRODUCTS__ || [];

  // ---------- ПОКУПАТЕЛИ (юрлица-плательщики) ----------
  // shipmentMode: "allowed" | "blocked" | "balance"
  //   allowed — отгрузка разрешена
  //   blocked — отгрузка запрещена, заказ уходит в статус "ожидает разблокировки"
  //   balance — проверка по текущему сальдо: если < 0, ведёт себя как blocked
  var BUYERS = [
    {
      id:1, code:"B-1024", name:"АО «ТД «Перекрёсток»»", legal:"АО «ТД «Перекрёсток»»", inn:"7728029110",
      sinceYear:2019, manager:"Ирина Соколова", managerPhone:"+7 (812) 660-55-11",
      email:"grazhdansky45@x5.ru", paymentDeferralDays:14,
      hasContract:true, contractNumber:"ДГ-1-2019", contractDate:"2019-03-14",
      balance: 214800, shipmentMode:"allowed", minOrderSum: 5000,
      password:"master1024", segment:"Сеть", badges:["Сеть","Онлайн-заказы"]
    },
    {
      id:2, code:"B-1156", name:"ООО «Хлебница»", legal:"ООО «Хлебница»", inn:"7811502233",
      sinceYear:2021, manager:"Дмитрий Ежов", managerPhone:"+7 (812) 660-55-11",
      email:"orders@hlebnitsa.spb.ru", paymentDeferralDays:7,
      hasContract:true, contractNumber:"ДГ-2-2021", contractDate:"2021-03-14",
      balance: -8400, shipmentMode:"balance", minOrderSum: 3000,
      password:"master1156", segment:"Кафе", badges:["HoReCa"]
    },
    {
      id:3, code:"B-1287", name:"ФГАОУ ВО «СПбГЭТУ «ЛЭТИ»»", legal:"ФГАОУ ВО «СПбГЭТУ «ЛЭТИ»»", inn:"7813045593",
      sinceYear:2018, manager:"Ирина Соколова", managerPhone:"+7 (812) 660-55-11",
      email:"canteen@etu.ru", paymentDeferralDays:30,
      hasContract:true, contractNumber:"ДГ-3-2018", contractDate:"2018-03-14",
      balance: 42300, shipmentMode:"allowed", minOrderSum: 4000,
      password:"master1287", segment:"Госсектор", badges:["Гос. учреждение","223-ФЗ"]
    },
    {
      id:4, code:"B-1342", name:"ИП Смирнов А. В.", legal:"ИП Смирнов А. В.", inn:"780612345678",
      sinceYear:2022, manager:"Дмитрий Ежов", managerPhone:"+7 (812) 660-55-11",
      email:"zakaz@u-doma.ru", paymentDeferralDays:7,
      hasContract:false, contractNumber:null, contractDate:null,
      balance: 5100, shipmentMode:"allowed", minOrderSum: 2500,
      password:"master1342", segment:"Розница", badges:["Новый клиент"]
    },
    {
      id:5, code:"B-1489", name:"ООО «Гурман»", legal:"ООО «Гурман»", inn:"7841998877",
      sinceYear:2020, manager:"Наталья Кравцова", managerPhone:"+7 (812) 660-55-11",
      email:"chef@gourmand-spb.ru", paymentDeferralDays:14,
      hasContract:true, contractNumber:"ДГ-5-2020", contractDate:"2020-03-14",
      balance: 88650, shipmentMode:"allowed", minOrderSum: 3500,
      password:"master1489", segment:"Ресторан", badges:["HoReCa","Приоритет"]
    },
    {
      id:6, code:"B-1573", name:"ООО «Север Север»", legal:"ООО «Север Север»", inn:"7838099002",
      sinceYear:2024, manager:"Дмитрий Ежов", managerPhone:"+7 (812) 660-55-11",
      email:"office@severnorth.ru", paymentDeferralDays:7,
      hasContract:true, contractNumber:"ДГ-6-2024", contractDate:"2024-03-14",
      balance: 12200, shipmentMode:"allowed", minOrderSum: 3000,
      password:"master1573", segment:"Кофейня", badges:["HoReCa","Ежедневная доставка"]
    },
    {
      id:7, code:"B-1622", name:"ООО «Невский Берег Отель»", legal:"ООО «Невский Берег Отель»", inn:"7842551020",
      sinceYear:2017, manager:"Наталья Кравцова", managerPhone:"+7 (812) 660-55-11",
      email:"fnb@nevskybereg.ru", paymentDeferralDays:21,
      hasContract:true, contractNumber:"ДГ-7-2017", contractDate:"2017-03-14",
      balance: 156400, shipmentMode:"allowed", minOrderSum: 6000,
      password:"master1622", segment:"Отель", badges:["HoReCa","Приоритет","Крупный заказ"]
    },
    {
      id:8, code:"B-1704", name:"АО «Торговый дом «Верный»", legal:"АО «Торговый дом «Верный»", inn:"7839022002",
      sinceYear:2016, manager:"Ирина Соколова", managerPhone:"+7 (812) 660-55-11",
      email:"pobed@vernyi.ru", paymentDeferralDays:30,
      hasContract:true, contractNumber:"ДГ-8-2016", contractDate:"2016-03-14",
      balance: 0, shipmentMode:"blocked", shipmentBlockReason:"Ожидается сверка по актам за июль",
      minOrderSum: 8000,
      password:"master1704", segment:"Сеть", badges:["Сеть","Крупный заказ","EDI"], usesEdi:true, ediClientCode:"4601234000158"
    },
    {
      id:9, code:"B-1815", name:"ГБДОУ детский сад № 128", legal:"ГБДОУ детский сад № 128 Калининского района", inn:"7804098871",
      sinceYear:2013, manager:"Ирина Соколова", managerPhone:"+7 (812) 660-55-11",
      email:"snab128@edu.gov.spb.ru", paymentDeferralDays:45,
      hasContract:true, contractNumber:"ДГ-9-2013", contractDate:"2013-03-14",
      balance: 27500, shipmentMode:"allowed", minOrderSum: 2000,
      password:"master1815", segment:"Госсектор", badges:["Гос. учреждение","223-ФЗ"]
    },
    {
      id:10, code:"B-1928", name:"ООО «Интернет Решения» (Ozon Fresh)", legal:"ООО «Интернет Решения»", inn:"7704217370",
      sinceYear:2023, manager:"Наталья Кравцова", managerPhone:"+7 (812) 660-55-11",
      email:"fresh-spb@ozon.ru", paymentDeferralDays:14,
      hasContract:true, contractNumber:"ДГ-10-2023", contractDate:"2023-03-14",
      balance: 74300, shipmentMode:"allowed", minOrderSum: 5000,
      password:"master1928", segment:"E-commerce", badges:["Маркетплейс","API-заказы"]
    },
    {
      id:11, code:"B-2015", name:"АО «Дикси Юг»", legal:"АО «Дикси Юг»", inn:"5036045205",
      sinceYear:2020, manager:"Сергей Кулагин", managerPhone:"+7 (812) 660-55-11",
      email:"spb-fresh@dixy.ru", paymentDeferralDays:21,
      hasContract:true, contractNumber:"ДГ-11-2020", contractDate:"2020-06-01",
      balance: 118500, shipmentMode:"allowed", minOrderSum: 6000,
      password:"master2015", segment:"Сеть", badges:["Сеть","EDI","Ежедневная доставка"], usesEdi:true, ediClientCode:"4601234000165"
    },
    {
      id:12, code:"B-2130", name:"ООО «Агроторг» (Пятёрочка СЗ)", legal:"ООО «Агроторг»", inn:"7825706086",
      sinceYear:2015, manager:"Ирина Соколова", managerPhone:"+7 (812) 660-55-11",
      email:"spb-bakery@x5.ru", paymentDeferralDays:30,
      hasContract:true, contractNumber:"ДГ-12-2015", contractDate:"2015-04-01",
      balance: 342100, shipmentMode:"allowed", minOrderSum: 8000,
      password:"master2130", segment:"Сеть", badges:["Сеть","EDI","Крупный заказ"], usesEdi:true, ediClientCode:"4601234000172"
    },
    {
      id:13, code:"B-2244", name:"ООО «Верный СПб»", legal:"ООО «Верный СПб»", inn:"7841077712",
      sinceYear:2019, manager:"Сергей Кулагин", managerPhone:"+7 (812) 660-55-11",
      email:"spb.orders@verny.ru", paymentDeferralDays:14,
      hasContract:true, contractNumber:"ДГ-13-2019", contractDate:"2019-09-10",
      balance: 67200, shipmentMode:"allowed", minOrderSum: 5000,
      password:"master2244", segment:"Сеть", badges:["Сеть","Ежедневная доставка"]
    },
    {
      id:14, code:"B-3001", name:"ООО «Балтхлеб-Трейд»", legal:"ООО «Балтхлеб-Трейд»", inn:"7802991177",
      sinceYear:2024, manager:"Наталья Кравцова", managerPhone:"+7 (812) 660-55-11",
      email:"office@balthleb-trade.ru", paymentDeferralDays:7,
      hasContract:true, contractNumber:"ДГ-14-2024", contractDate:"2024-11-05",
      balance: 14800, shipmentMode:"allowed", minOrderSum: 3000,
      password:"skryt3001", segment:"Розница", badges:["Приоритет"]
    },
    {
      id:15, code:"B-1467", name:"АО «Тандер» (Магнит)", legal:"АО «Тандер»", inn:"2310031475",
      sinceYear:2021, manager:"Сергей Кулагин", managerPhone:"+7 (812) 660-55-11",
      email:"spb-fresh@magnit.ru", paymentDeferralDays:21,
      hasContract:true, contractNumber:"ДГ-15-2021", contractDate:"2021-05-18",
      balance: 198600, shipmentMode:"allowed", minOrderSum: 6000,
      password:"master1467", segment:"Сеть", badges:["Сеть","EDI"], usesEdi:true, ediClientCode:"4601234000189"
    },
    {
      id:16, code:"B-1590", name:"ООО «Лента»", legal:"ООО «Лента»", inn:"7814148471",
      sinceYear:2022, manager:"Наталья Кравцова", managerPhone:"+7 (812) 660-55-11",
      email:"spb-bakery@lenta.ru", paymentDeferralDays:30,
      hasContract:true, contractNumber:"ДГ-16-2022", contractDate:"2022-02-09",
      balance: 91200, shipmentMode:"allowed", minOrderSum: 7000,
      password:"master1590", segment:"Сеть", badges:["Сеть","EDI"], usesEdi:true, ediClientCode:"4601234000196"
    }
  ];

  // ---------- ТОЧКИ (получатели) ----------
  // password: пароль только для входа на эту точку
  // rep: свой торговый представитель точки
  // minOrderSum: если задана — переопределяет minOrderSum покупателя
  // deliverySchedule: массив 7 элементов по дням недели [Пн,Вт,Ср,Чт,Пт,Сб,Вс].
  //                   Каждый элемент — массив часов начала слота (0..23). Слот длится 1 час: [7] → «07:00–08:00».
  //                   [] — в этот день доставки нет. Максимум 6 слотов в день.
  var OUTLETS = [
    // Перекрёсток (id:1) — сеть, 4 точки
    // П-01: автомагазин, 2 доставки/день ПнСрПт (утро + день)
    {id:101, platform:"karavay", buyerId:1, code:"P-1024-01", name:"Пятёрочка, пр. Гражданский, 45", address:"СПб, пр. Гражданский, 45", phones:["+7 (812) 555-10-11"], deliverySchedule:[[7,13],[7,13],[7,13],[7,13],[7,13],[],[]], rep:"Ольга Тимофеева", repPhone:"+7 (921) 900-10-11", password:"grz2026", minOrderSum:5000, receiver:"Морозова Е. В."},
    {id:102, platform:"kush", buyerId:1, code:"P-1024-02", name:"Пятёрочка, ул. Есенина, 18", address:"СПб, ул. Есенина, 18", phones:["+7 (812) 555-10-12"], deliverySchedule:[[7],[7],[7],[7],[7],[],[]], rep:"Ольга Тимофеева", repPhone:"+7 (921) 900-10-11", password:"esn2026", minOrderSum:5000, receiver:"Иванов К. С."},
    // П-03: большой магазин, 3 доставки в будни, 2 в Сб
    {id:103, platform:"zarya", buyerId:1, code:"P-1024-03", name:"Пятёрочка, пр. Ветеранов, 90", address:"СПб, пр. Ветеранов, 90", phones:["+7 (812) 555-10-13"], deliverySchedule:[[6,11,16],[6,11,16],[6,11,16],[6,11,16],[6,11,16],[7,13],[]], rep:"Сергей Кулагин", repPhone:"+7 (921) 900-10-14", password:"vet2026", minOrderSum:6000, receiver:"Петрова А. Н."},
    {id:104, platform:"karavay", buyerId:1, code:"P-1024-04", name:"Пятёрочка, ул. Савушкина, 112", address:"СПб, ул. Савушкина, 112", phones:["+7 (812) 555-10-14"], deliverySchedule:[[7,14],[7,14],[7,14],[7,14],[7,14],[],[]], rep:"Сергей Кулагин", repPhone:"+7 (921) 900-10-14", password:"sav2026", minOrderSum:5000, receiver:"Смирнова О. И."},

    // Хлебница (id:2) — 1 точка, кафе — встречает утром только
    {id:201, platform:"kush", buyerId:2, code:"H-1156-01", name:"Кафе «Хлебница», Марата, 20", address:"СПб, ул. Марата, 20", phones:["+7 (812) 555-11-56"], deliverySchedule:[[],[7],[],[7],[],[7],[]], rep:"Дмитрий Ежов", repPhone:"+7 (812) 660-55-11", password:"marata2026", minOrderSum:3000, receiver:"Кузнецова Л. П."},

    // ЛЭТИ (id:3) — 1 точка, столовая — утром до завтрака
    {id:301, platform:"zarya", buyerId:3, code:"L-1287-01", name:"Столовая ЛЭТИ, Профессора Попова, 5", address:"СПб, ул. Профессора Попова, 5", phones:["+7 (812) 234-27-87"], deliverySchedule:[[7],[7],[7],[7],[7],[],[]], rep:"Ирина Соколова", repPhone:"+7 (812) 660-55-11", password:"leti2026", minOrderSum:4000, receiver:"Никитин Д. Е."},

    // У дома (id:4) — 1 точка, одна доставка Пн/Пт утром (без договора!)
    {id:401, platform:"karavay", buyerId:4, code:"U-1342-01", name:"Магазин «У дома», Есенина, 12", address:"СПб, ул. Есенина, 12", phones:["+7 (812) 555-13-42"], deliverySchedule:[[8],[],[],[],[8],[],[]], rep:"Дмитрий Ежов", repPhone:"+7 (812) 660-55-11", password:"udoma2026", minOrderSum:2500, receiver:"Смирнов А. В."},

    // Гурман (id:5) — 1 точка, ресторан, 2 доставки ВтЧтСб (утро и к вечеру)
    {id:501, platform:"kush", buyerId:5, code:"G-1489-01", name:"Ресторан «Гурман», Невский, 88", address:"СПб, Невский пр., 88", phones:["+7 (812) 555-14-89"], deliverySchedule:[[],[9,16],[],[9,16],[],[9,16],[]], rep:"Наталья Кравцова", repPhone:"+7 (812) 660-55-11", password:"nevsky2026", minOrderSum:3500, receiver:"Гурянов И. С."},

    // Север Север (id:6) — 3 кофейни, ежедневно по 3–4 доставки
    // С-01: МАКС 6 слотов в день (топовая точка, большая проходимость)
    {id:601, platform:"zarya", buyerId:6, code:"S-1573-01", name:"«Север Север», Сенная пл., 3", address:"СПб, Сенная пл., 3", phones:["+7 (812) 555-15-73"], deliverySchedule:[[6,9,12,15,18],[6,9,12,15,18],[6,9,12,15,18],[6,9,12,15,18],[6,9,12,15,18,20],[7,11,15,18],[8,13,17]], rep:"Дмитрий Ежов", repPhone:"+7 (812) 660-55-11", password:"sennaya2026", minOrderSum:2500, receiver:"Юрьева М. К."},
    {id:602, platform:"karavay", buyerId:6, code:"S-1573-02", name:"«Север Север», ул. Рубинштейна, 15", address:"СПб, ул. Рубинштейна, 15", phones:["+7 (812) 555-15-74"], deliverySchedule:[[7,12,16],[7,12,16],[7,12,16],[7,12,16],[7,12,16,19],[9,14,17],[10,15]], rep:"Дмитрий Ежов", repPhone:"+7 (812) 660-55-11", password:"rub2026", minOrderSum:2500, receiver:"Панин С. О."},
    {id:603, platform:"kush", buyerId:6, code:"S-1573-03", name:"«Север Север», Приморский пр., 62", address:"СПб, Приморский пр., 62", phones:["+7 (812) 555-15-75"], deliverySchedule:[[7,13,17],[7,13,17],[7,13,17],[7,13,17],[7,13,17],[9,14],[10]], rep:"Сергей Кулагин", repPhone:"+7 (921) 900-10-14", password:"prim2026", minOrderSum:3000, receiver:"Осипова Т. В."},

    // Невский Берег (id:7) — 2 отеля, завтрак+ужин
    {id:701, platform:"karavay", buyerId:7, code:"N-1622-01", name:"Отель «Невский Берег», Мойка, 82", address:"СПб, наб. реки Мойки, 82", phones:["+7 (812) 555-16-22"], deliverySchedule:[[6,17],[6,17],[6,17],[6,17],[6,17],[6,17],[7,17]], rep:"Наталья Кравцова", repPhone:"+7 (812) 660-55-11", password:"moyka2026", minOrderSum:6000, receiver:"Дементьева О. С."},
    {id:702, platform:"kush", buyerId:7, code:"N-1622-02", name:"Отель «Невский Берег», Гончарная, 4", address:"СПб, ул. Гончарная, 4", phones:["+7 (812) 555-16-23"], deliverySchedule:[[6,17],[6,17],[6,17],[6,17],[6,17],[6,17],[7,17]], rep:"Наталья Кравцова", repPhone:"+7 (812) 660-55-11", password:"gonch2026", minOrderSum:6000, receiver:"Костина Р. И."},

    // Верный (id:8) — сеть, 4 точки, у покупателя shipment=blocked
    // РЦ Кудрово — крупный склад, много окон приёма
    {id:801, platform:"kush", buyerId:8, code:"V-1704-01", name:"«Верный», РЦ Кудрово (V1)", address:"ЛО, Кудрово, РЦ «V1»", phones:["+7 (812) 555-17-04"], deliverySchedule:[[4,7,10,14,18],[4,7,10,14,18],[4,7,10,14,18],[4,7,10,14,18],[4,7,10,14,18],[5,9,14],[6,12]], rep:"Ирина Соколова", repPhone:"+7 (812) 660-55-11", password:"kud2026", minOrderSum:10000, receiver:"Логистика РЦ"},
    {id:802, platform:"zarya", buyerId:8, code:"V-1704-02", name:"«Верный», Комендантский пр., 17", address:"СПб, Комендантский пр., 17", phones:["+7 (812) 555-17-05"], deliverySchedule:[[7,14],[7,14],[7,14],[7,14],[7,14],[8,14],[9]], rep:"Ирина Соколова", repPhone:"+7 (812) 660-55-11", password:"kmnd2026", minOrderSum:8000, receiver:"Волкова Н. А."},
    {id:803, platform:"karavay", buyerId:8, code:"V-1704-03", name:"«Верный», пр. Науки, 14", address:"СПб, пр. Науки, 14", phones:["+7 (812) 555-17-06"], deliverySchedule:[[7,14],[7,14],[7,14],[7,14],[7,14],[8,14],[9]], rep:"Ольга Тимофеева", repPhone:"+7 (921) 900-10-11", password:"nauki2026", minOrderSum:8000, receiver:"Тихонов И. Р."},
    {id:804, platform:"kush", buyerId:8, code:"V-1704-04", name:"«Верный», Ленинский пр., 100", address:"СПб, Ленинский пр., 100", phones:["+7 (812) 555-17-07"], deliverySchedule:[[7,14],[7,14],[7,14],[7,14],[7,14],[8,14],[9]], rep:"Сергей Кулагин", repPhone:"+7 (921) 900-10-14", password:"lenin2026", minOrderSum:8000, receiver:"Захарова М. Т."},

    // Детский сад (id:9) — 1 точка, только будни утром до завтрака
    {id:901, platform:"zarya", buyerId:9, code:"D-1815-01", name:"Детский сад №128, Гражданская, 14", address:"СПб, ул. Гражданская, 14", phones:["+7 (812) 555-18-15"], deliverySchedule:[[7],[7],[7],[7],[7],[],[]], rep:"Ирина Соколова", repPhone:"+7 (812) 660-55-11", password:"sad2026", minOrderSum:2000, receiver:"Завхоз Тарасова Е."},

    // Ozon Fresh (id:10) — 2 тёмные кухни, Пн–Сб, 4 доставки/день
    {id:1001, platform:"karavay", buyerId:10, code:"O-1928-01", name:"Ozon Fresh, пр. Энергетиков, 25К4", address:"СПб, пр. Энергетиков, 25К4", phones:["+7 (812) 555-19-28"], deliverySchedule:[[5,10,14,19],[5,10,14,19],[5,10,14,19],[5,10,14,19],[5,10,14,19],[6,11,15,19],[]], rep:"Наталья Кравцова", repPhone:"+7 (812) 660-55-11", password:"energ2026", minOrderSum:5000, receiver:"Оператор смены"},
    {id:1002, platform:"kush", buyerId:10, code:"O-1928-02", name:"Ozon Fresh, ул. Софийская, 8", address:"СПб, ул. Софийская, 8", phones:["+7 (812) 555-19-29"], deliverySchedule:[[5,10,14,19],[5,10,14,19],[5,10,14,19],[5,10,14,19],[5,10,14,19],[6,11,15,19],[]], rep:"Наталья Кравцова", repPhone:"+7 (812) 660-55-11", password:"sof2026", minOrderSum:5000, receiver:"Оператор смены"},

    // Дикси (id:11) — 3 точки, ежедневно 2 доставки
    {id:1101, platform:"kush", buyerId:11, code:"D-2015-01", name:"Дикси, Ленсовета, 92", address:"СПб, ул. Ленсовета, 92", phones:["+7 (812) 555-20-15"], deliverySchedule:[[6,14],[6,14],[6,14],[6,14],[6,14],[7,14],[]], rep:"Сергей Кулагин", repPhone:"+7 (921) 900-10-14", password:"lens2026", minOrderSum:6000, receiver:"Журавлёв Я. М."},
    {id:1102, platform:"zarya", buyerId:11, code:"D-2015-02", name:"Дикси, Заневский пр., 65", address:"СПб, Заневский пр., 65", phones:["+7 (812) 555-20-16"], deliverySchedule:[[6,14],[6,14],[6,14],[6,14],[6,14],[7,14],[]], rep:"Сергей Кулагин", repPhone:"+7 (921) 900-10-14", password:"zan2026", minOrderSum:6000, receiver:"Мамедова Г. И."},
    {id:1103, platform:"karavay", buyerId:11, code:"D-2015-03", name:"Дикси, Народного Ополчения, 30", address:"СПб, Народного Ополчения, 30", phones:["+7 (812) 555-20-17"], deliverySchedule:[[6,14],[6,14],[6,14],[6,14],[6,14],[],[]], rep:"Сергей Кулагин", repPhone:"+7 (921) 900-10-14", password:"nar2026", minOrderSum:6000, receiver:"Кальков А. С."},

    // Агроторг / Пятёрочка СЗ (id:12) — 3 точки, будни 3 доставки
    {id:1201, platform:"zarya", buyerId:12, code:"P-2130-01", name:"Пятёрочка, Комендантский, 22", address:"СПб, Комендантский пр., 22", phones:["+7 (812) 555-21-30"], deliverySchedule:[[5,11,16],[5,11,16],[5,11,16],[5,11,16],[5,11,16],[6,12],[]], rep:"Ольга Тимофеева", repPhone:"+7 (921) 900-10-11", password:"kom2026", minOrderSum:8000, receiver:"Лобанов С. В."},
    {id:1202, platform:"karavay", buyerId:12, code:"P-2130-02", name:"Пятёрочка, Бухарестская, 74", address:"СПб, ул. Бухарестская, 74", phones:["+7 (812) 555-21-31"], deliverySchedule:[[5,11,16],[5,11,16],[5,11,16],[5,11,16],[5,11,16],[6,12],[]], rep:"Ольга Тимофеева", repPhone:"+7 (921) 900-10-11", password:"buh2026", minOrderSum:8000, receiver:"Киреева О. А."},
    {id:1203, platform:"kush", buyerId:12, code:"P-2130-03", name:"Пятёрочка, Культуры, 21", address:"СПб, пр. Культуры, 21", phones:["+7 (812) 555-21-32"], deliverySchedule:[[5,11,16],[5,11,16],[5,11,16],[5,11,16],[5,11,16],[6,12],[]], rep:"Ольга Тимофеева", repPhone:"+7 (921) 900-10-11", password:"kult2026", minOrderSum:8000, receiver:"Савельев И. Н."},

    // Верный (id:13) — 2 точки
    {id:1301, platform:"karavay", buyerId:13, code:"V-2244-01", name:"Верный, Космонавтов, 47", address:"СПб, пр. Космонавтов, 47", phones:["+7 (812) 555-22-44"], deliverySchedule:[[7,14],[7,14],[7,14],[7,14],[7,14],[8,13],[]], rep:"Сергей Кулагин", repPhone:"+7 (921) 900-10-14", password:"kos2026", minOrderSum:5000, receiver:"Гончарова Т. М."},
    {id:1302, platform:"kush", buyerId:13, code:"V-2244-02", name:"Верный, Московский, 208", address:"СПб, Московский пр., 208", phones:["+7 (812) 555-22-45"], deliverySchedule:[[7,14],[7,14],[7,14],[7,14],[7,14],[8,13],[]], rep:"Сергей Кулагин", repPhone:"+7 (921) 900-10-14", password:"mos2026", minOrderSum:5000, receiver:"Кочетков В. С."},

    // Балтхлеб-Трейд (id:14) — скрытый клиент, 1 точка
    {id:1401, platform:"kush", buyerId:14, code:"K-3001-01", name:"Магазин «Свежая выпечка», Лесной, 41", address:"СПб, Лесной пр., 41", phones:["+7 (812) 555-30-01"], deliverySchedule:[[7],[],[7],[],[7],[7],[]], rep:"Наталья Кравцова", repPhone:"+7 (812) 660-55-11", password:"lesn2026", minOrderSum:3000, receiver:"Зав. магазином Новиков П."},

    // Тандер / Магнит (id:15) — EDI-клиент, но иногда заказывает и через кабинет
    {id:1501, platform:"karavay", buyerId:15, code:"M-1467-01", name:"Магнит, Среднеохтинский пр., 30", address:"СПб, Среднеохтинский пр., 30", phones:["+7 (812) 555-14-67"], deliverySchedule:[[6,12],[6,12],[6,12],[6,12],[6,12],[7,13],[]], rep:"Сергей Кулагин", repPhone:"+7 (921) 900-10-14", password:"magn2026", minOrderSum:6000, receiver:"Макарова Е. В."},
    {id:1502, platform:"kush", buyerId:15, code:"M-1467-02", name:"Магнит, дальневосточный, 71", address:"СПб, дальневосточный пр., 71", phones:["+7 (812) 555-14-68"], deliverySchedule:[[6,12],[6,12],[6,12],[6,12],[6,12],[7,13],[]], rep:"Сергей Кулагин", repPhone:"+7 (921) 900-10-14", password:"dalnv2026", minOrderSum:6000, receiver:"Соколова И. Н."},

    // Лента (id:16) — EDI-клиент, но иногда заказывает и через кабинет
    {id:1601, platform:"zarya", buyerId:16, code:"T-1590-01", name:"Лента, Светлановский пр., 118", address:"СПб, Светлановский пр., 118", phones:["+7 (812) 555-15-90"], deliverySchedule:[[5,13],[5,13],[5,13],[5,13],[5,13],[6,14],[]], rep:"Наталья Кравцова", repPhone:"+7 (812) 660-55-11", password:"lenta2026", minOrderSum:7000, receiver:"Григорьева Н. П."}
  ];

  // Справочники для UI
  // Площадки отгрузки и телефоны диспетчерской (заглушки — заполнить актуальными номерами)
  var PLATFORMS = {
    kush:    {name:"Кушелевка", phone:"+7 (812) 000-00-01"},
    zarya:   {name:"Заря",      phone:"+7 (812) 000-00-02"},
    karavay: {name:"Каравай",   phone:"+7 (812) 000-00-03"}
  };

  // ===== v2.0: модель КИС (ТЗ «Личный кабинет клиента» ver.2) =====
  // Состояния заказа — как в КИС
  var STATE_ACCEPTED = "Принят";
  var STATE_ROUTED   = "Маршрутизирован";
  var STATE_ONWAY    = "В пути";
  var STATE_SHIPPED  = "Отгружен";
  var STATE_DELETED  = "Удален";
  var STATES = [STATE_ACCEPTED, STATE_ROUTED, STATE_ONWAY, STATE_SHIPPED];
  // Группы продукции: 0 — ЗПФ (замороженные полуфабрикаты), 1 — ХБИ (хлебобулочные)
  var GROUP_ZPF = 0, GROUP_HBI = 1;
  var SOURCES = ["web","voice","operator","edi"];
  var WD_SHORT = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
  // Идентификаторы КИС строим детерминированно от внутренних id демо-данных
  function payerKisId(id){ return 288336 + id; }
  function clientKisId(id){ return 299655 + id; }
  function prodKisId(i){ return 425430 + i; }
  function toUnix(d){ return Math.floor(d.getTime()/1000); }
  function fromUnix(t){ return new Date(Number(t)*1000); }

  function seed(s){return function(){s=(s*9301+49297)%233280;return s/233280}}
  function daysAgo(n){var d=new Date();d.setHours(9,0,0,0);d.setDate(d.getDate()-n);return d}
  function fmt(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
  function round2(x){return Math.round(x*100)/100}
  function norm(s){ return String(s||'').trim().toUpperCase().replace(/\u041a/g,"K").replace(/\u0412/g,"B"); }

  function outletsOfBuyer(bid){ return OUTLETS.filter(function(o){return o.buyerId===bid}); }

  // ---------- НОМЕНКЛАТУРА ----------
  // Обогащаем прайс полями КИС: id_prd, Group, KolUkl (укладка), KolshtOrdmin (мин. заказ).
  // Пустой KolshtOrdmin означает, что продукция грузится только лотками.
  var CATALOG = PRODUCTS.map(function(p, i){
    return {
      id_prd: prodKisId(i),
      KodProd: String(p.code),
      NameProd: p.name,
      Vesprod: Number(p.weight) || 0,
      MarketingGroup: p.category || "Прочее",
      Srok: p.shelf || "",
      KolUkl: (p.piecesPerLot > 0) ? p.piecesPerLot : 1,
      // BaseCenaOTP — базовая цена с НДС; для акционных позиций базой служит старая цена
      BaseCenaOTP: round2(Number(p.oldPrice || p.price) || 0),
      // ТЗ: пустой KolshtOrdmin означает, что продукция грузится только лотками
      KolshtOrdmin: p.lotOnly ? null : (Number(p.minOrder) || 1),
      Group: /Заморо/i.test(p.category || "") ? GROUP_ZPF : GROUP_HBI,
      lk_basePrice: round2(Number(p.price) || 0),
      lk_promo: !!p.isPromo
    };
  });
  function findProd(idPrd){ return CATALOG.find(function(x){ return x.id_prd === Number(idPrd); }); }

  // ---------- МАТРИЦА ПРОДУКЦИИ ПО ПОЛУЧАТЕЛЯМ ----------
  // В КИС ассортимент и цена индивидуальны для каждого получателя:
  // у сети своя скидка, у точки — свой набор позиций.
  var MATRIX = {};   // {outletId: [{id_prd, ProcSkd, CenaOTP, ...}]}
  function buildMatrix(){
    OUTLETS.forEach(function(o){
      var b = findBuyer(o.buyerId) || {};
      var rb = seed(o.buyerId * 37 + 11);
      // скидка покупателя: у сетей глубже
      var disc = round2((b.segment === "Сеть" ? 12 : 4) + rb() * 7);
      var ro = seed(o.id * 13 + 7);
      var rows = [];
      CATALOG.forEach(function(p){
        // ~80% ассортимента у точки; «Современные хлеба» есть почти везде (бывшая «Новая продукция»)
        var always = /Современные хлеба/i.test(p.MarketingGroup);
        if(!always && ro() > 0.8) return;
        // Скидка клиента действует на весь ассортимент; на промо-позициях она глубже.
        // Признака акции в ТЗ нет — он выводится из того, что ProcSkd выше базовой.
        var pDisc = disc + (p.lk_promo ? 8 + ro()*7 : 0);
        var cena = round2(p.lk_basePrice * (1 - pDisc/100));
        var realDisc = p.BaseCenaOTP > 0 ? round2((1 - cena/p.BaseCenaOTP) * 100) : 0;
        rows.push({
          id_prd: p.id_prd, KodProd: p.KodProd, NameProd: p.NameProd,
          Vesprod: p.Vesprod, MarketingGroup: p.MarketingGroup, Srok: p.Srok,
          KolUkl: p.KolUkl, BaseCenaOTP: p.BaseCenaOTP,
          ProcSkd: realDisc, CenaOTP: cena,
          KolshtOrdmin: p.KolshtOrdmin, Group: p.Group
        });
      });
      MATRIX[o.id] = rows;
    });
  }
  function matrixFor(outletId, group){
    var rows = MATRIX[Number(outletId)] || [];
    if(group === null || group === undefined || group === '') return rows;
    return rows.filter(function(r){ return r.Group === Number(group); });
  }
  function priceFor(outletId, idPrd){
    var row = (MATRIX[Number(outletId)] || []).find(function(r){ return r.id_prd === Number(idPrd); });
    return row || null;
  }

  // ---------- ОГРАНИЧЕНИЯ ПО ДНЯМ НЕДЕЛИ ----------
  // В КИС приходит ClientDayOfWeek. Демо-данные выводим из старого графика точки.
  function clientDaysOfWeek(o){
    var sch = o.deliverySchedule || [];
    var days = [];
    for(var i=0;i<7;i++){ if(sch[i] && sch[i].length) days.push(i); }
    if(!days.length) days = [0,1,2,3,4];
    return days;
  }
  function daysLabel(days){
    if(days.length === 7) return ["Ежедневно"];
    return days.map(function(i){ return WD_SHORT[i]; });
  }
  // Пн=0..Вс=6
  function ruDow(d){ return (d.getDay() + 6) % 7; }
  function outletAcceptsDate(o, dateObj){
    return clientDaysOfWeek(o).indexOf(ruDow(dateObj)) >= 0;
  }
  function findBuyerByCode(code){ var c=norm(code); return BUYERS.find(function(b){return norm(b.code)===c}); }
  function findOutletByCode(code){ var c=norm(code); return OUTLETS.find(function(o){return norm(o.code)===c}); }
  function findBuyer(id){ return BUYERS.find(function(b){return b.id===Number(id)}); }
  function findOutlet(id){ return OUTLETS.find(function(o){return o.id===Number(id)}); }

  // Расчёт эффективного статуса отгрузки
  // Приоритет:
  //   1. нет договора (hasContract=false) → blocked
  //   2. shipmentMode=blocked → blocked (с ручной причиной)
  //   3. shipmentMode=balance и balance<0 → blocked (по сальдо)
  //   4. иначе → allowed
  // Самое первое срабатывает — остальные проверки не выполняются.
  function effectiveShipment(buyer){
    if(buyer.hasContract === false){
      return {state:"blocked", reason:"Нет действующего договора поставки", cause:"no_contract"};
    }
    if(buyer.shipmentMode==="blocked") return {state:"blocked", reason: buyer.shipmentBlockReason || "Отгрузка временно приостановлена", cause:"manual"};
    if(buyer.shipmentMode==="balance"){
      if((buyer.balance||0) < 0) return {state:"blocked", reason:"Отрицательное сальдо: "+ new Intl.NumberFormat('ru-RU').format(buyer.balance) +" ₽", cause:"balance"};
      return {state:"allowed", reason:null, cause:null};
    }
    return {state:"allowed", reason:null, cause:null};
  }

  // ---------- СЕРИАЛИЗАТОРЫ КИС ----------
  // Поля и имена — как в ТЗ ver.2. Локальные поля (договор, телефоны, площадка)
  // КИС не отдаёт: они приходят из справочника ЛК и помечены префиксом lk_.
  function payerKIS(b){
    var eff = effectiveShipment(b);
    return {
      Id_pay: payerKisId(b.id),
      KodPay: b.code,
      NamePay: b.name,
      Adres: b.legal || b.name,
      NamePRV: b.shipmentMode === "balance" ? "Расчет текущего сальдо"
             : (b.shipmentMode === "blocked" ? "Отгрузка запрещена" : "Без ограничений"),
      SumOutSaldoCalc: round2(b.balance || 0),
      OrdLimitMinSum: round2(b.minOrderSum || 0),
      Manager: b.manager,
      // -- поля ЛК, которых нет в КИС --
      lk_id: b.id,
      lk_managerPhone: b.managerPhone || null,
      lk_inn: b.inn || null,
      lk_hasContract: b.hasContract !== false,
      lk_contractNumber: b.contractNumber || null,
      lk_contractDate: b.contractDate || null,
      lk_paymentDeferralDays: b.paymentDeferralDays || 0,
      lk_segment: b.segment || null,
      lk_shipmentEffective: eff.state,
      lk_shipmentEffectiveReason: eff.reason,
      lk_shipmentEffectiveCause: eff.cause || null,
      Clients: outletsOfBuyer(b.id).map(clientKIS)
    };
  }
  function clientKIS(o){
    var days = clientDaysOfWeek(o);
    return {
      Id_pay: payerKisId(o.buyerId),
      id_clt: clientKisId(o.id),
      KodClt: o.code,
      NameClt: o.name,
      Adres: o.address,
      OrdLimitMinSum: round2(o.minOrderSum || 0),
      TorgPred: o.rep || null,
      ClientDayOfWeek: daysLabel(days),
      // -- поля ЛК --
      lk_id: o.id,
      lk_buyerId: o.buyerId,
      lk_days: days,
      lk_phones: o.phones || [],
      lk_repPhone: o.repPhone || null,
      lk_receiver: o.receiver || null,
      lk_dispatchPhone: (PLATFORMS[o.platform] && PLATFORMS[o.platform].phone) || null,
      lk_dispatchPlatformName: (PLATFORMS[o.platform] && PLATFORMS[o.platform].name) || null
    };
  }
  function orderKIS(o){
    var ol = findOutlet(o.outletId) || {};
    return {
      id_clt: clientKisId(o.outletId),
      KodClt: ol.code,
      NameClt: ol.name,
      Adres: ol.address,
      Id_ord: o.id,
      NumOrd: o.orderNumber,
      DateOrdClt: o.createdAtUnix,
      DateOrd: o.deliveryUnix,
      Group: o.group,
      KolSht: o.totalUnits,
      SumAll: round2(o.total),
      State: o.state,
      // -- поля ЛК --
      lk_outletId: o.outletId,
      lk_buyerId: o.buyerId,
      lk_source: o.source
    };
  }
  function orderDetailsKIS(o){
    return {
      id_ord: o.id,
      Group: o.group,
      Product: o.items.map(function(it){
        return {
          id_prd: it.id_prd,
          KodProd: it.KodProd,
          NameProd: it.NameProd,
          CenaOTP: round2(it.CenaOTP),
          Kolsht: it.Kolsht,
          KolVzv: it.KolVzv || 0,
          SumAll: round2(it.CenaOTP * it.Kolsht),
          lk_KolUkl: it.KolUkl || 1
        };
      })
    };
  }

  // ---------- ЗАКАЗЫ ----------
  // Заказ принадлежит покупателю И конкретной точке
  var ORDERS_BY_BUYER = {};   // {buyerId: [orders]}
  var ORDERS_BY_OUTLET = {};  // {outletId: [orders]}
  function findOrderById(id){
    var want = Number(id), found = null;
    Object.keys(ORDERS_BY_BUYER).some(function(k){
      found = ORDERS_BY_BUYER[k].find(function(o){ return o.id === want; });
      return !!found;
    });
    return found || null;
  }
  function _pushOrder(o){
    (ORDERS_BY_BUYER[o.buyerId] = ORDERS_BY_BUYER[o.buyerId]||[]).push(o);
    (ORDERS_BY_OUTLET[o.outletId] = ORDERS_BY_OUTLET[o.outletId]||[]).push(o);
  }

  function buildOrders(){
    BUYERS.forEach(function(b){
      outletsOfBuyer(b.id).forEach(function(ol){
        var r = seed(ol.id*137), base = 100000 + b.id*1000 + (ol.id%1000)*10;
        var rows = matrixFor(ol.id, null);
        if(!rows.length) return;
        // ТЗ: история — заказы за последние 14 дней плюс все незавершённые
        for(var i=0;i<6;i++){
          var back = i===0 ? -2 : i===1 ? -1 : (i-1)*3 + Math.floor(r()*2);
          var delivery = daysAgo(back), created = daysAgo(back+1);
          // дата поставки должна попадать в разрешённые дни недели точки
          var guard = 0;
          while(!outletAcceptsDate(ol, delivery) && guard++ < 7){
            delivery.setDate(delivery.getDate() + (back < 0 ? 1 : -1));
          }
          var state = back < 0 ? (back <= -2 ? STATE_ACCEPTED : STATE_ONWAY)
                               : (back <= 1 ? STATE_SHIPPED : STATE_SHIPPED);
          if(back === 0) state = STATE_ROUTED;
          // заказ целиком в одной группе — в КИС ЗПФ и ХБИ не смешиваются
          var grp = (i % 4 === 3) ? GROUP_ZPF : GROUP_HBI;
          var pool = rows.filter(function(x){ return x.Group === grp; }).slice();
          if(!pool.length){ grp = GROUP_HBI; pool = rows.filter(function(x){ return x.Group === grp; }).slice(); }
          if(!pool.length) continue;
          var cnt = 3 + Math.floor(r()*5), chosen = [];
          for(var j=0;j<cnt && pool.length;j++){
            var row = pool.splice(Math.floor(r()*pool.length), 1)[0];
            var minQ = row.KolshtOrdmin || row.KolUkl;
            var qty = Math.max(minQ, 5 + Math.floor(r()*40));
            if(row.KolshtOrdmin == null) qty = Math.max(1, Math.round(qty/row.KolUkl)) * row.KolUkl;
            chosen.push({
              id_prd: row.id_prd, KodProd: row.KodProd, NameProd: row.NameProd,
              KolUkl: row.KolUkl, Kolsht: qty, CenaOTP: row.CenaOTP,
              KolVzv: (state === STATE_SHIPPED && r() > 0.75) ? Math.floor(r()*3) : 0
            });
          }
          var totalUnits = chosen.reduce(function(a,c){ return a + c.Kolsht; }, 0);
          var totalSum = round2(chosen.reduce(function(a,c){ return a + c.CenaOTP*c.Kolsht; }, 0));
          _pushOrder({
            id: base+i, orderNumber: base+i, buyerId: b.id, outletId: ol.id,
            group: grp,
            deliveryUnix: toUnix(delivery), createdAtUnix: toUnix(created),
            state: state, source: SOURCES[Math.floor(r()*SOURCES.length)],
            items: chosen, totalUnits: totalUnits, total: totalSum
          });
        }
      });
    });
    Object.keys(ORDERS_BY_BUYER).forEach(function(k){ ORDERS_BY_BUYER[k].sort(function(a,b){return b.orderNumber-a.orderNumber}) });
    Object.keys(ORDERS_BY_OUTLET).forEach(function(k){ ORDERS_BY_OUTLET[k].sort(function(a,b){return b.orderNumber-a.orderNumber}) });
  }

  var DOCS = {};
  function buildDocs(){
    BUYERS.forEach(function(b){
      var firstOrder = (ORDERS_BY_BUYER[b.id]||[])[0];
      DOCS[b.id]=[
        {
          id:1,
          kind:"declaration",
          number:"Приложение к ТТН №1438025",
          orderId: firstOrder && firstOrder.id,
          title:"Перечень действующих документов о соответствии на поставляемую продукцию",
          date:"2026-08-06",
          href:"docs/Reestr-deklaratsii-sootvetstviia.pdf"
        },
        {
          id:2,
          kind:"pricelist",
          number:"Прайс-лист",
          orderId:null,
          title:"Прайс-лист на продукцию",
          date:"2026-08-01",
          href:"#"
        }
      ];
    });
  }

  buildMatrix();
  buildOrders();
  buildDocs();
  var nextOrderNum = 200999;

  // ---------- FETCH ----------
  function jsonResp(obj, status){return new Response(JSON.stringify(obj), {status:status||200, headers:{"Content-Type":"application/json"}})}
  // ТЗ ver.3: 204 (No Content) — ответ без тела (реальный fetch не даёт создать Response
  // с телом и статусом 204/205/304 — поэтому пустой ответ строим отдельно)
  function emptyResp(status){ return new Response(null, {status: status||204}); }
  function parsePath(url){
    try{ var u = new URL(url, location.origin); return u.pathname.replace(/^\/port\/5000/, ""); }catch(e){ return String(url).replace(/^\/port\/5000/, ""); }
  }

  var _fetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var path = parsePath(url);
    var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (!/^\/api\//.test(path)) return _fetch(input, init);

    // query-параметр запроса
    function qp(name){
      try { return new URL(url, location.origin || "http://x").searchParams.get(name); }
      catch(e){
        var m = String(url).match(new RegExp("[?&]" + name + "=([^&]*)"));
        return m ? decodeURIComponent(m[1]) : null;
      }
    }
    function body(){
      try{ return init && init.body ? JSON.parse(init.body) : {}; }catch(e){ return {}; }
    }

    // ---------- LOGIN ----------
    // Возможные комбинации (см. шапку файла).
    if (path === "/api/login" && method === "POST") {
      var b0 = body();
      var code = norm(b0.code);
      var pass = String(b0.password||"");

      // 1) код покупателя + мастер-пароль → доступ ко всем точкам
      var buyerByCode = findBuyerByCode(code);
      if(buyerByCode && pass === buyerByCode.password){
        return Promise.resolve(jsonResp({
          role:"buyer", scope:"all-outlets",
          payer: payerKIS(buyerByCode)
        }));
      }

      // 2) код точки + мастер-пароль покупателя → доступ ко всем точкам покупателя
      // 3) код точки + пароль точки → доступ только к этой точке
      var outlet = findOutletByCode(code);
      if(outlet){
        var buyer = findBuyer(outlet.buyerId);
        if(buyer && pass === buyer.password){
          return Promise.resolve(jsonResp({
            role:"buyer", scope:"all-outlets",
            payer: payerKIS(buyer),
            enteredOutletId: outlet.id
          }));
        }
        if(pass === outlet.password){
          return Promise.resolve(jsonResp({
            role:"outlet", scope:"single-outlet",
            payer: payerKIS(buyer),
            client: clientKIS(outlet)
          }));
        }
      }

      return Promise.resolve(jsonResp({error:"invalid_credentials"}, 401));
    }

    // ---------- LOOKUP (для доверенного вида) ----------
    if (path === "/api/lookup" && method === "GET") {
      var lq;
      try{ lq = new URL(url, location.origin).searchParams.get('code')||''; }catch(e){ lq = ''; }
      var lcode = norm(lq);
      var lb = findBuyerByCode(lcode);
      if(lb) return Promise.resolve(jsonResp({kind:"buyer", id:lb.id, code:lb.code, name:lb.name, segment:lb.segment}));
      var lo = findOutletByCode(lcode);
      if(lo){
        var lbo = findBuyer(lo.buyerId);
        return Promise.resolve(jsonResp({kind:"outlet", id:lo.id, code:lo.code, name:lo.name, buyerName: lbo && lbo.name}));
      }
      return Promise.resolve(jsonResp({error:"not_found"}, 404));
    }

    // =====================================================================
    // API v1 — методы КИС по ТЗ «Личный кабинет клиента» ver.3
    // Ресурсы сгруппированы как /payers, /clients, /orders. Даты — Unix-таймстемпы.
    // =====================================================================
    var V1 = "/api/v1";

    // I.1 Данные покупателя: GET /api/v1/payers/{id_pay}
    var mPayer = path.match(/^\/api\/v1\/payers\/(\d+)$/);
    if (mPayer && method === "GET") {
      var pb = BUYERS.find(function(x){ return payerKisId(x.id) === Number(mPayer[1]); });
      if(!pb) return Promise.resolve(emptyResp(204)); // ТЗ: 204 — нет покупателя
      return Promise.resolve(jsonResp(payerKIS(pb)));
    }

    // I.2 Получатели покупателя: GET /api/v1/payers/{id_pay}/clients
    var mPayerClients = path.match(/^\/api\/v1\/payers\/(\d+)\/clients$/);
    if (mPayerClients && method === "GET") {
      var cb = BUYERS.find(function(x){ return payerKisId(x.id) === Number(mPayerClients[1]); });
      if(!cb) return Promise.resolve(emptyResp(204)); // ТЗ: 204 — нет покупателя
      return Promise.resolve(jsonResp({
        Id_pay: payerKisId(cb.id),
        Clients: outletsOfBuyer(cb.id).map(clientKIS)
      }));
    }

    // I.3 Заказы покупателя (по всем получателям): GET /api/v1/payers/{id_pay}/orders?offset=&limit=
    var mPayerOrders = path.match(/^\/api\/v1\/payers\/(\d+)\/orders$/);
    if (mPayerOrders && method === "GET") {
      var ob = BUYERS.find(function(x){ return payerKisId(x.id) === Number(mPayerOrders[1]); });
      if(!ob) return Promise.resolve(emptyResp(204)); // ТЗ: 204 — нет покупателя
      var list = (ORDERS_BY_BUYER[ob.id] || []).slice();
      // ТЗ: заказы за последние 14 дней плюс все незавершённые
      var edge = toUnix(daysAgo(14));
      list = list.filter(function(o){
        return o.deliveryUnix >= edge || (o.state !== STATE_SHIPPED && o.state !== STATE_DELETED);
      });
      if(!list.length) return Promise.resolve(emptyResp(204)); // ТЗ: 204 — нет заказов за 14 дней
      var total = list.length;
      var off = Number(qp('offset') || 0), lim = Number(qp('limit') || 0);
      if(off) list = list.slice(off);
      if(lim) list = list.slice(0, lim);
      return Promise.resolve(jsonResp({
        id_pay: payerKisId(ob.id),
        lk_total: total,
        Orders: list.map(orderKIS)
      }));
    }

    // II.1 Информация по получателю: GET /api/v1/clients/{id_clt}
    var mClientOne = path.match(/^\/api\/v1\/clients\/(\d+)$/);
    if (mClientOne && method === "GET") {
      var co1 = OUTLETS.find(function(x){ return clientKisId(x.id) === Number(mClientOne[1]); });
      if(!co1) return Promise.resolve(jsonResp({detail:"Получатель не найден"}, 404));
      return Promise.resolve(jsonResp(clientKIS(co1)));
    }

    // II.2 Матрица продукции с ценами: GET /api/v1/clients/{id_clt}/matrix?DateOrd=&Group=
    var mMatrix = path.match(/^\/api\/v1\/clients\/(\d+)\/matrix$/);
    if (mMatrix && method === "GET") {
      var mo = OUTLETS.find(function(x){ return clientKisId(x.id) === Number(mMatrix[1]); });
      if(!mo) return Promise.resolve(jsonResp({detail:"Получатель не найден"}, 404));
      var dateOrd = qp('DateOrd'), grp = qp('Group');
      if(!dateOrd) return Promise.resolve(jsonResp({detail:"Некорректный параметр DateOrd"}, 400));
      if(grp === null || grp === '') return Promise.resolve(jsonResp({detail:"Некорректный параметр Group"}, 400));
      var dObj = fromUnix(dateOrd);
      if(isNaN(dObj.getTime())) return Promise.resolve(jsonResp({detail:"Некорректный параметр DateOrd"}, 400));
      if(!outletAcceptsDate(mo, dObj)){
        return Promise.resolve(jsonResp({
          detail: "Получатель не принимает поставку в этот день недели",
          ClientDayOfWeek: daysLabel(clientDaysOfWeek(mo))
        }, 400));
      }
      return Promise.resolve(jsonResp({
        id_clt: clientKisId(mo.id),
        DateOrd: Number(dateOrd),
        Group: Number(grp),
        Product: matrixFor(mo.id, grp)
      }));
    }

    // II.3 Заказы получателя: GET /api/v1/clients/{id_clt}/orders?last=1
    // За 14 дней + незавершённые. last=1 — только последний принятый заказ.
    var mClientOrders = path.match(/^\/api\/v1\/clients\/(\d+)\/orders$/);
    if (mClientOrders && method === "GET") {
      var co2 = OUTLETS.find(function(x){ return clientKisId(x.id) === Number(mClientOrders[1]); });
      if(!co2) return Promise.resolve(jsonResp({detail:"Получатель не найден"}, 404));
      var list2 = (ORDERS_BY_OUTLET[co2.id] || []).slice();
      var edge2 = toUnix(daysAgo(14));
      list2 = list2.filter(function(o){
        return o.deliveryUnix >= edge2 || (o.state !== STATE_SHIPPED && o.state !== STATE_DELETED);
      });
      if(qp('last') === '1'){
        var lastAcc = list2.filter(function(o){ return o.state === STATE_ACCEPTED; })
                          .sort(function(a,b){ return b.createdAtUnix - a.createdAtUnix; })[0];
        list2 = lastAcc ? [lastAcc] : [];
      }
      if(!list2.length) return Promise.resolve(emptyResp(204)); // ТЗ: 204 — нет заказов за 14 дней
      return Promise.resolve(jsonResp({
        id_clt: clientKisId(co2.id),
        Orders: list2.map(orderKIS)
      }));
    }

    // III.2 Детализация заказа: GET /api/v1/orders/{id_ord}
    var mDet = path.match(/^\/api\/v1\/orders\/(\d+)$/);
    if (mDet && method === "GET") {
      var dord = findOrderById(mDet[1]);
      if(!dord) return Promise.resolve(jsonResp({detail:"Заказ не найден"}, 404));
      return Promise.resolve(jsonResp(orderDetailsKIS(dord)));
    }

    // III.1 Создать заказ: POST /api/v1/orders/
    if ((path === V1 + "/orders" || path === V1 + "/orders/") && method === "POST") {
      var nb = body();
      var nOut = OUTLETS.find(function(x){ return clientKisId(x.id) === Number(nb.Id_clt); });
      if(!nOut) return Promise.resolve(jsonResp({detail:"Некорректный параметр Id_clt"}, 400));
      var nBuyer = findBuyer(nOut.buyerId);
      if(!nb.DateOrd) return Promise.resolve(jsonResp({detail:"Некорректный параметр DateOrd"}, 400));
      var nDate = fromUnix(nb.DateOrd);
      if(isNaN(nDate.getTime())) return Promise.resolve(jsonResp({detail:"Некорректный параметр DateOrd"}, 400));
      if(!outletAcceptsDate(nOut, nDate)){
        return Promise.resolve(jsonResp({
          detail: "Получатель не принимает поставку в этот день недели",
          ClientDayOfWeek: daysLabel(clientDaysOfWeek(nOut))
        }, 422));
      }
      var nItems = (nb.Product || []).map(function(it){
        var row = priceFor(nOut.id, it.Id_prd != null ? it.Id_prd : it.id_prd);
        if(!row) return null;
        return {
          id_prd: row.id_prd, KodProd: row.KodProd, NameProd: row.NameProd,
          KolUkl: row.KolUkl, Kolsht: Number(it.KolSht) || 0,
          CenaOTP: row.CenaOTP, KolVzv: 0
        };
      }).filter(function(x){ return x && x.Kolsht > 0; });
      if(!nItems.length) return Promise.resolve(jsonResp({detail:"Некорректный параметр Product"}, 400));
      // все позиции заказа должны быть из одной группы
      var grpSet = {};
      nItems.forEach(function(it){
        var row = priceFor(nOut.id, it.id_prd);
        if(row) grpSet[row.Group] = 1;
      });
      if(Object.keys(grpSet).length > 1){
        return Promise.resolve(jsonResp({detail:"Некорректный параметр Group: ЗПФ и ХБИ нельзя смешивать в одном заказе"}, 400));
      }
      var nGroup = Number(Object.keys(grpSet)[0]);
      var nUnits = nItems.reduce(function(a,c){ return a + c.Kolsht; }, 0);
      var nSum = round2(nItems.reduce(function(a,c){ return a + c.CenaOTP*c.Kolsht; }, 0));
      // минимальная сумма: приоритет у получателя
      var nMin = (nOut.minOrderSum != null ? nOut.minOrderSum : nBuyer.minOrderSum) || 0;
      if(nSum < nMin){
        return Promise.resolve(jsonResp({
          detail: "Сумма заказа ниже минимальной для получателя",
          lk_error: "below_min_sum", lk_minSum: nMin, lk_total: nSum
        }, 400));
      }
      // ТЗ ver.3: 402 — не хватает средств (нет договора / ручная блокировка / отрицательное сальдо)
      var nEff = effectiveShipment(nBuyer);
      if(nEff.state === "blocked"){
        return Promise.resolve(jsonResp({
          detail: "Не хватает средств для оплаты заказа. Обратитесь к менеджеру",
          lk_cause: nEff.cause, lk_reason: nEff.reason
        }, 402));
      }
      nextOrderNum++;
      var nOrder = {
        id: nextOrderNum, orderNumber: nextOrderNum,
        buyerId: nBuyer.id, outletId: nOut.id, group: nGroup,
        deliveryUnix: Number(nb.DateOrd), createdAtUnix: toUnix(new Date()),
        state: STATE_ACCEPTED, source: "web",
        items: nItems, totalUnits: nUnits, total: nSum
      };
      _pushOrder(nOrder);
      ORDERS_BY_BUYER[nBuyer.id].sort(function(a,b){ return b.orderNumber - a.orderNumber; });
      ORDERS_BY_OUTLET[nOut.id].sort(function(a,b){ return b.orderNumber - a.orderNumber; });
      return Promise.resolve(jsonResp(orderKIS(nOrder)));
    }

    // III.4 Удалить заказ: DELETE /api/v1/orders/{id_ord}
    var mDelete = path.match(/^\/api\/v1\/orders\/(\d+)$/);
    if (mDelete && method === "DELETE") {
      var sOrd = findOrderById(mDelete[1]);
      if(!sOrd) return Promise.resolve(jsonResp({detail:"Заказ не найден"}, 404));
      if(sOrd.state !== STATE_ACCEPTED){
        return Promise.resolve(jsonResp({detail:"Заказ маршрутизирован, изменения запрещены"}, 422));
      }
      sOrd.state = STATE_DELETED;
      return Promise.resolve(jsonResp({Id_ord: sOrd.id, State: sOrd.state}));
    }

    // III.3 Изменить заказ: PUT /api/v1/orders/{id_ord}
    var mPut = path.match(/^\/api\/v1\/orders\/(\d+)$/);
    if (mPut && method === "PUT") {
      var uOrd = findOrderById(mPut[1]);
      if(!uOrd) return Promise.resolve(jsonResp({detail:"Заказ не найден"}, 404));
      if(uOrd.state !== STATE_ACCEPTED){
        return Promise.resolve(jsonResp({detail:"Заказ маршрутизирован, изменения запрещены"}, 422));
      }
      var ub = body();
      var uOut = findOutlet(uOrd.outletId);
      var uItems = (ub.Product || []).map(function(it){
        var row = priceFor(uOrd.outletId, it.Id_prd != null ? it.Id_prd : it.id_prd);
        if(!row) return null;
        return {
          id_prd: row.id_prd, KodProd: row.KodProd, NameProd: row.NameProd,
          KolUkl: row.KolUkl, Kolsht: Number(it.KolSht) || 0,
          CenaOTP: row.CenaOTP, KolVzv: 0
        };
      }).filter(function(x){ return x && x.Kolsht > 0; });
      if(!uItems.length) return Promise.resolve(jsonResp({detail:"Некорректный параметр Product"}, 400));
      var uBuyer = findBuyer(uOrd.buyerId);
      var uSum = round2(uItems.reduce(function(a,c){ return a + c.CenaOTP*c.Kolsht; }, 0));
      var uMin = (uOut.minOrderSum != null ? uOut.minOrderSum : uBuyer.minOrderSum) || 0;
      if(uSum < uMin){
        return Promise.resolve(jsonResp({
          detail: "Сумма заказа ниже минимальной для получателя",
          lk_error: "below_min_sum", lk_minSum: uMin, lk_total: uSum
        }, 400));
      }
      // ТЗ ver.3: 402 — не хватает средств (правка заказа тоже упирается в баланс)
      var uEff = effectiveShipment(uBuyer);
      if(uEff.state === "blocked"){
        return Promise.resolve(jsonResp({
          detail: "Не хватает средств для оплаты заказа. Обратитесь к менеджеру",
          lk_cause: uEff.cause, lk_reason: uEff.reason
        }, 402));
      }
      uOrd.items = uItems;
      uOrd.totalUnits = uItems.reduce(function(a,c){ return a + c.Kolsht; }, 0);
      uOrd.total = uSum;
      return Promise.resolve(jsonResp({
        Id_ord: uOrd.id, KolSht: uOrd.totalUnits, SumAll: uOrd.total, State: uOrd.state
      }));
    }

    // ---------- ДОКУМЕНТЫ (нет в ТЗ, справочник ЛК) ----------
    var mDocs = path.match(/^\/api\/buyers\/(\d+)\/documents$/);
    if (mDocs && method === "GET") {
      return Promise.resolve(jsonResp(DOCS[Number(mDocs[1])] || []));
    }

    return Promise.resolve(jsonResp({detail:"Не найдено: "+path}, 404));
  };

})();
