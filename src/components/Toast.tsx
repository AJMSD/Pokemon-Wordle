import React, { useEffect, useRef } from 'react'
import { WarningDiamond } from 'pixelarticons/react/WarningDiamond'
import { Check } from 'pixelarticons/react/Check'
import { InfoBox } from 'pixelarticons/react/InfoBox'
import { Close } from 'pixelarticons/react/Close'

export interface ToastProps {
  message: string;
  type: 'error' | 'success' | 'info';
  onClose: () => void;
  duration?: number;
}

const Toast: React.FC<ToastProps> = ({ 
  message, 
  type, 
  onClose, 
  duration = 3000 
}) => {
  // Timer reference to handle auto-dismiss functionality
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Set up auto-dismiss timer
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    
    timerRef.current = setTimeout(onClose, duration);
    
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [duration, onClose]);
  
  // Style mapping based on toast type
  const bgColor = {
    error: 'bg-red-100 border-red-400 text-red-700',
    success: 'bg-green-100 border-green-400 text-green-700',
    info: 'bg-blue-100 border-blue-400 text-blue-700'
  }[type];
  
  // Icon mapping based on toast type
  const iconType = {
    error: <WarningDiamond width={24} height={24} aria-hidden="true" />,
    success: <Check width={24} height={24} aria-hidden="true" />,
    info: <InfoBox width={24} height={24} aria-hidden="true" />,
  }[type];
  
  return (
    <div role={type === 'error' ? 'alert' : 'status'} className={`fixed bottom-20 left-1/2 transform -translate-x-1/2 px-4 py-3 border-2 ${bgColor} pixel-frame flex items-center space-x-2 max-w-sm w-full z-50`}>
      <div className="flex-shrink-0">
        {iconType}
      </div>
      <div className="flex-1">
        {message}
      </div>
      <button 
        onClick={onClose}
        className="text-gray-500 hover:text-gray-800 pixel-focus"
        aria-label="Close"
      >
<Close width={24} height={24} aria-hidden="true" />
      </button>
    </div>
  );
};

export default Toast;
