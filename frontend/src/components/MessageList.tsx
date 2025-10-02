import clsx from 'clsx';
import type { AgentMessage } from '../types';

interface MessageListProps {
  messages: AgentMessage[];
  streamingAnswer?: string;
  isStreaming?: boolean;
}

export function MessageList({ messages, streamingAnswer, isStreaming }: MessageListProps) {
  const combined = streamingAnswer && streamingAnswer.length
    ? [...messages, { role: 'assistant', content: streamingAnswer }]
    : messages;

  if (combined.length === 0) {
    return (
      <div className="empty-state">
        <h2>Welcome!</h2>
        <p>Ask about NASA’s Earth at Night study, and I’ll cite the supporting sources.</p>
        <ul>
          <li>“Why is the Phoenix street grid so bright at night?”</li>
          <li>“Summarize the main findings from the Earth at Night dataset.”</li>
          <li>“How does NASA gather nighttime imagery?”</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="messages-container">
      {combined.map((message, index) => (
        <div
          key={`${message.role}-${index}`}
          className={clsx('message', `message-${message.role}`)}
        >
          <div className="message-avatar">
            {message.role === 'assistant' ? '🤖' : message.role === 'user' ? '👤' : '🛠️'}
          </div>
          <div className="message-body">
            <div className="message-role">{message.role}</div>
            <div className="message-content">{message.content}</div>
            {isStreaming && index === combined.length - 1 && (
              <span className="typing-indicator">
                <span />
                <span />
                <span />
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
