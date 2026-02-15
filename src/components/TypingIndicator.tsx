export function TypingIndicator() {
  return (
    <div className="typing-indicator" aria-label="Agent is typing" role="status">
      <div className="typing-dot" />
      <div className="typing-dot" />
      <div className="typing-dot" />
    </div>
  );
}
