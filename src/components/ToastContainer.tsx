import React from 'react'
import Toast, { ToastProps } from './Toast'

interface ToastContainerProps {
  toasts: (ToastProps & { id: string })[];
  removeToast: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, removeToast }) => {
  if (toasts.length === 0) return null;
  
  return (
    <div className="fixed bottom-0 left-0 right-0 p-4 flex flex-col items-center space-y-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => removeToast(toast.id)}
            duration={toast.duration}
          />
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
