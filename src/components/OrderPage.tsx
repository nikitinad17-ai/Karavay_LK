import { useStore } from '../store';
import OrderSetup from './OrderSetup';
import OrderCatalog from './OrderCatalog';

export default function OrderPage() {
  const { state } = useStore();
  return state.orderReady ? <OrderCatalog /> : <OrderSetup />;
}
