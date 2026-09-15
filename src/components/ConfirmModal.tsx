import { useStore } from '../store';

export default function ConfirmModal() {
  const { state, patch } = useStore();
  const c = state.confirm;
  if (!c) return null;

  const close = () => patch({ confirm: null });
  const onOk = () => { close(); if (c.onOk) c.onOk(); };
  const onCancel = () => { close(); if (c.onCancel) c.onCancel(); };

  const okCls = 'btn ' + (c.danger ? 'btn--danger' : 'btn--primary');
  return (
    <div className="confirm-back" onClick={onCancel}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal__head">{c.title}</div>
        {/* body может содержать <strong> из вызывающего кода — оставляем как HTML, источник наш же */}
        <div className="confirm-modal__body" dangerouslySetInnerHTML={{ __html: c.body }} />
        <div className="confirm-modal__foot">
          <button className="btn btn--secondary" type="button" onClick={onCancel}>{c.cancelText}</button>
          <button className={okCls} type="button" onClick={onOk}>{c.okText}</button>
        </div>
      </div>
    </div>
  );
}
