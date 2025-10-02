import { useState, KeyboardEvent } from 'react';

interface ChatInputProps {
  disabled?: boolean;
  onSend: (message: string) => void;
}

export function ChatInput({ disabled, onSend }: ChatInputProps) {
  const [value, setValue] = useState('');

  const handleSend = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-input">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything about the Earth at Night dataset…"
        disabled={disabled}
        rows={3}
      />
      <button onClick={handleSend} disabled={disabled || !value.trim()}>
        {disabled ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}
