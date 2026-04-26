import { ReactNode, useId } from 'react';

interface FormFieldProps {
  label: string;
  required?: boolean;
  children: ReactNode;
  hint?: string;
  error?: string;
}

export function FormField({ label, required, children, hint, error }: FormFieldProps) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">
        {label}{required && <span className="text-loga-red ml-0.5" aria-hidden="true">*</span>}
        {required && <span className="sr-only"> (obligatorio)</span>}
      </label>
      {children}
      {hint  && <p className="text-[11px] text-gray-400">{hint}</p>}
      {error && <p className="text-[11px] text-loga-red" role="alert">{error}</p>}
    </div>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}
export function Input({ error, className = '', ...props }: InputProps) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-all
        ${error
          ? 'border-loga-red focus:ring-2 focus:ring-red-100'
          : 'border-gray-200 focus:border-loga-red focus:ring-2 focus:ring-red-100'
        } ${className}`}
    />
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}
export function Select({ className = '', children, ...props }: SelectProps) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none
        focus:border-loga-red focus:ring-2 focus:ring-red-100 transition-all bg-white ${className}`}
    >
      {children}
    </select>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}
export function Textarea({ className = '', ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none
        focus:border-loga-red focus:ring-2 focus:ring-red-100 transition-all resize-none ${className}`}
    />
  );
}
