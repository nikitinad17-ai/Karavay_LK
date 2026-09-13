import { useStore } from '../store.jsx';
import OrderSetup from './OrderSetup.jsx';
import OrderCatalog from './OrderCatalog.jsx';

export default function OrderPage() {
  const { state } = useStore();
  return state.orderReady ? <OrderCatalog /> : <OrderSetup />;
}
