import { useState, useCallback } from 'react';

// Generates a unique ID for each toast message
const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

type ToastType = 'error' | 'success' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  onClose?: () => void;
}

// Custom hook for managing toast notifications
export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // Adds a new toast notification
  const addToast = useCallback((message: string, type: ToastType = 'info', duration = 3000) => {
    const id = generateId();
    const newToast = { 
      id, 
      message, 
      type, 
      duration,
      onClose: () => removeToast(id)
    };
    
    setToasts(prev => [...prev, newToast]);
    return id;
  }, []);
  
  // Removes a toast by ID
  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);
  
  // Convenience methods for specific toast types
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
