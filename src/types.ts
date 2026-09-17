import type { Dispatch, ReactNode } from 'react';

export type Role = 'buyer' | 'outlet';
export type BuyerAccessRole = 'owner' | 'manager' | 'viewer';
export type Route = 'login' | 'buyer-select' | 'dashboard' | 'order' | 'orders' | 'outlets' | 'documents' | 'profile';
export type OrderFilter = 'all' | 'in-cart' | 'promo';
export type OrderGroup = 0 | 1;
export type OrderStatus = 'accepted' | 'routed' | 'onway' | 'shipped' | 'deleted';
export type OrderPill = 'accepted' | 'picked' | 'shipped' | 'delivered' | 'cancelled';
export type ShipmentMode = 'allowed' | 'blocked' | 'balance';
export type ShipmentCause = 'no_contract' | 'manual' | 'balance' | null;

export interface Outlet {
  recordId: string | null;
  buyerRecordId: string | null;
  id: number;
  id_clt: number;
  code: string;
  name: string;
  address: string;
  minOrderSum: number;
  rep: string | null;
  days: number[];
  daysLabel: string;
  phones: string[];
  repPhone: string | null;
  receiver: string | null;
  dispatchPhone: string | null;
  dispatchPlatformName: string | null;
}

export interface Buyer {
  recordId: string | null;
  id: number;
  Id_pay: number;
  code: string;
  name: string;
  legal: string;
  manager: string | null;
  managerPhone: string | null;
  balance: number;
  minOrderSum: number;
  shipmentRule: string | null;
  inn: string | null;
  segment: string | null;
  hasContract: boolean;
  contractNumber: string | null;
  contractDate: string | null;
  paymentDeferralDays: number;
  email: string | null;
  sinceYear: number | null;
  shipmentMode: ShipmentMode;
  shipmentBlockReason: string | null;
  shipmentEffective: 'allowed' | 'blocked';
  shipmentEffectiveReason: string | null;
  shipmentEffectiveCause: ShipmentCause;
  usesEdi: boolean;
  ediClientCode: string | null;
  badges: string[];
  outlets: Outlet[];
}

export interface AuthenticatedUser {
  id: string;
  login: string;
  name: string;
  active: boolean;
  mustChangePassword: boolean;
}

export interface BuyerMembership {
  id: string;
  userId: string;
  buyerId: string;
  role: BuyerAccessRole;
  active: boolean;
}

export interface UserBuyerAccess {
  membership: BuyerMembership;
  buyer: Buyer;
}

export interface UserDirectory {
  user: AuthenticatedUser;
  accesses: UserBuyerAccess[];
}

export interface SelectedBuyerContext {
  userId: string;
  buyerId: string;
  membership: BuyerMembership;
  buyer: Buyer;
  outlets: Outlet[];
}

export interface Product {
  id: number;
  id_prd?: number;
  code: string;
  name: string;
  category: string;
  categoryOrder?: number;
  weight: number;
  price: number;
  priceBase?: number;
  pricePerKg?: number;
  vat?: number;
  unit: string;
  packaging?: string;
  shelf: string;
  minOrder: number;
  piecesPerLot: number;
  isPromo: boolean;
  oldPrice: number | null;
  discount?: number;
  lotOnly: boolean;
  group?: number;
}

export interface OrderItem {
  id_prd: number;
  code: string;
  name: string;
  price: number;
  qty: number;
  returned: number;
  sum: number;
  piecesPerLot: number;
  lotOnly: boolean;
  minOrder: number;
}

export interface Order {
  id: number;
  orderNumber: number;
  buyerId: number;
  outletId: number;
  outletCode: string;
  outletName: string;
  outletAddress: string;
  deliveryDate: string | null;
  createdAt: string | null;
  group: number;
  totalUnits: number;
  total: number;
  state: string;
  status: OrderStatus;
  pill: OrderPill;
  source: string | null;
  items: OrderItem[] | null;
}

export interface OrderSnapshot {
  items: Array<Pick<OrderItem, 'qty' | 'sum' | 'price' | 'code' | 'id_prd'>>;
  totalUnits: number;
  total: number;
}

export interface DocumentRecord {
  id: number;
  kind: 'contract' | 'invoice' | 'act' | 'pricelist' | 'declaration' | string;
  number: string;
  orderId: number | null;
  title: string;
  date: string;
  href: string;
}

export interface CartDetail {
  lots: number;
  pcs: number;
}

export interface ToastMessage {
  msg: string;
  type: '' | 'success' | 'error';
}

export interface ConfirmState {
  title: string;
  body: string;
  okText: string;
  cancelText: string;
  danger?: boolean;
  onOk?: () => void;
  onCancel?: () => void;
}

export interface DeviceClient {
  kind?: Role;
  id?: number;
  code: string;
  name: string;
  segment?: string | null;
  buyerName?: string | null;
}

export interface AppState {
  authenticatedUser: AuthenticatedUser | null;
  userDirectory: UserDirectory | null;
  selectedBuyerContext: SelectedBuyerContext | null;
  buyerSelectionRequired: boolean;
  buyerSwitching: boolean;
  buyerSwitchError: string;
  buyer: Buyer | null;
  role: Role | null;
  outlets: Outlet[];
  currentOutletId: number | null;
  profileOutletId: number | null;
  products: Product[];
  baseDiscount: number;
  ordersAll: Order[];
  documents: DocumentRecord[];
  cart: Record<string, number>;
  cartDetails: Record<string, CartDetail>;
  categories: string[];
  filter: OrderFilter;
  route: Route;
  loading: boolean;
  toast: ToastMessage | null;
  modalOrder: Order | null;
  editSnapshot: OrderSnapshot | null;
  productSearch: string;
  deviceClient: DeviceClient | null;
  prefillCode: string;
  confirm: ConfirmState | null;
  filtersOpen: boolean;
  ordersOutletFilter: 'all' | number;
  orderGroup: OrderGroup;
  orderDate: string | null;
  matrixLoading: boolean;
  matrixError: string | null;
  detailsCache: Record<string, OrderItem[]>;
  orderReady: boolean;
  setupLastOrder: Order | 'loading' | null;
  setupLastOrderOutlet: number | null;
  reviewOpen: boolean;
  reviewError: string;
  submittingOrder: boolean;
  initialLoadError: string;
  orderEditError: string;
}

export type StatePatch = Partial<AppState>;

export type StoreAction =
  | { type: 'PATCH'; payload: StatePatch }
  | { type: 'LOGOUT' };

export interface StoreContextValue {
  state: AppState;
  patch: (payload: StatePatch) => void;
  dispatch: Dispatch<StoreAction>;
  getState: () => AppState;
  beginRequest: (key: string) => number;
  isLatestRequest: (key: string, id: number) => boolean;
}

export interface StoreProviderProps {
  children: ReactNode;
}

export interface ApiErrorPayload {
  detail?: string;
  message?: string;
  error?: string;
  _status?: number;
  lk_error?: string;
  lk_minSum?: number;
  lk_total?: number;
  lk_cause?: string | null;
  lk_reason?: string | null;
}

export interface KisClient {
  lk_id: number;
  id_clt: number;
  KodClt: string;
  NameClt: string;
  Adres: string;
  OrdLimitMinSum: number;
  TorgPred?: string | null;
  ClientDayOfWeek?: string[];
  lk_days?: number[];
  lk_phones?: string[];
  lk_repPhone?: string | null;
  lk_receiver?: string | null;
  lk_dispatchPhone?: string | null;
  lk_dispatchPlatformName?: string | null;
}

export interface KisPayer {
  lk_id: number;
  Id_pay: number;
  KodPay: string;
  NamePay: string;
  Adres: string;
  Manager?: string | null;
  SumOutSaldoCalc?: number;
  OrdLimitMinSum?: number;
  NamePRV?: string | null;
  lk_managerPhone?: string | null;
  lk_inn?: string | null;
  lk_segment?: string | null;
  lk_hasContract?: boolean;
  lk_contractNumber?: string | null;
  lk_contractDate?: string | null;
  lk_paymentDeferralDays?: number;
  lk_email?: string | null;
  lk_sinceYear?: number | null;
  lk_shipmentMode?: ShipmentMode | null;
  lk_shipmentBlockReason?: string | null;
  lk_shipmentEffective?: 'allowed' | 'blocked' | null;
  lk_shipmentEffectiveReason?: string | null;
  lk_shipmentEffectiveCause?: ShipmentCause;
  lk_usesEdi?: boolean;
  lk_ediClientCode?: string | null;
  lk_badges?: string[];
  Clients?: KisClient[];
}

export interface KisProduct {
  id_prd: number;
  KodProd: string;
  NameProd: string;
  MarketingGroup?: string;
  Vesprod?: number;
  Srok?: string;
  KolUkl?: number;
  CenaOTP: number;
  BaseCenaOTP?: number;
  ProcSkd?: number;
  KolshtOrdmin?: number | null;
  Group?: number;
}

export interface KisOrder {
  Id_ord: number;
  NumOrd: number;
  lk_buyerId: number;
  lk_outletId: number;
  KodClt?: string;
  NameClt?: string;
  Adres?: string;
  DateOrd?: number;
  DateOrdClt?: number;
  Group?: number;
  KolSht?: number;
  SumAll?: number;
  State: string;
  lk_source?: string | null;
}

export interface KisOrderItem {
  id_prd: number;
  KodProd?: string;
  NameProd?: string;
  CenaOTP?: number;
  Kolsht?: number;
  KolVzv?: number;
  SumAll?: number;
  lk_KolUkl?: number;
  lk_lotOnly?: boolean;
  lk_minOrder?: number | null;
}

export interface LoginResponse {
  role: Role;
  payer: KisPayer;
  client?: KisClient;
  enteredOutletId?: number;
}

export interface OrdersResponse {
  Orders?: KisOrder[];
}

export interface MatrixResponse {
  Product?: KisProduct[];
}

export interface OrderDetailsResponse {
  Product?: KisOrderItem[];
}

export interface OrderMutationResponse {
  Id_ord: number;
  NumOrd?: number;
  State: string;
  KolSht?: number;
  SumAll?: number;
  lk_buyerId?: number;
  lk_outletId?: number;
}

export interface ReviewItem {
  p: Product;
  qty: number;
  sum: number;
  error: string;
}

export interface InvalidCartItem {
  pid: number;
  product?: Product;
  error: string;
}

export interface ReviewData {
  items: ReviewItem[];
  total: number;
  units: number;
  outlet: Outlet | null;
  minimum: number;
  missing: number;
  invalidCart: InvalidCartItem[];
  canReview: boolean;
  canSubmit: boolean;
}
