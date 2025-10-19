import clsx from 'clsx';
import type { ChatMessage, Citation } from '../types';
import { parseMessageWithCitations } from '../utils/citationParser';

interface MessageListProps {
  messages: ChatMessage[];
  streamingAnswer?: string;
  isStreaming?: boolean;
  citations?: Citation[];
}

export function MessageList({ messages, streamingAnswer, isStreaming, citations }: MessageListProps) {
  const combined: ChatMessage[] =
    isStreaming && streamingAnswer && streamingAnswer.length
      ? [
          ...messages,
          {
            id: 'streaming',
            role: 'assistant',
            content: streamingAnswer,
            citations
          }
        ]
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
          key={message.id ?? `${message.role}-${index}`}
          className={clsx('message', `message-${message.role}`)}
        >
          <div className="message-avatar">
            {message.role === 'assistant' ? '🤖' : message.role === 'user' ? '👤' : '🛠️'}
          </div>
          <div className="message-body">
            <div className="message-role">{message.role}</div>
            <div className="message-content">
              {parseMessageWithCitations(
                message.content ?? '',
                message.role === 'assistant' ? message.citations : undefined,
                message.id
              )}
            </div>
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
