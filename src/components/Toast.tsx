import { useStore } from '../store';

export default function Toast() {
  const { state } = useStore();
  if (!state.toast) return null;
  const cls = state.toast.type === 'success' ? 'toast--success' : state.toast.type === 'error' ? 'toast--error' : '';
  return <div className={'toast ' + cls}>{state.toast.msg}</div>;
}
