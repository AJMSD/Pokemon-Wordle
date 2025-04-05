import { useState, useCallback } from 'react';

// Simple ID generator as fallback for uuid
const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

type ToastType = 'error' | 'success' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  onClose?: () => void;  // Add onClose property
}

export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  const addToast = useCallback((message: string, type: ToastType = 'info', duration = 3000) => {
    const id = generateId();
    setToasts(prev => [...prev, { 
      id, 
      message, 
      type, 
      duration,
      onClose: () => removeToast(id)  // Add onClose implementation
    }]);
    return id;
  }, []);
  
  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);
  
  // Properly memoize these functions to prevent infinite renders
  const showError = useCallback((message: string) => addToast(message, 'error'), [addToast]);
  const showSuccess = useCallback((message: string) => addToast(message, 'success'), [addToast]);
  const showInfo = useCallback((message: string) => addToast(message, 'info'), [addToast]);
  
  return {
    toasts,
    addToast,
    removeToast,
    showError,
    showSuccess,
    showInfo
  };
};

export default useToast;
