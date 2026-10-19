import { useState, useEffect, useRef, useCallback } from "react";
import { Send, X, Bot, User, Shield, Zap } from "lucide-react";
import { advisorChat, advisorChatSuggestions } from "../advisorClient.js";

/**
 * ChatDrawer — "Ask Sentinel" conversational copilot.
 *
 * Renders as a slide-out panel inside the Decision Advisor. Shows:
 * - Suggested question chips
 * - Streaming text responses
 * - Proposed actions as cards with Approve/Ignore
 * - "AI-generated, verify before acting" label
 * - "data as of <timestamp>" footer
 */

let _sessionId = "";
function getSessionId() {
  if (!_sessionId) _sessionId = `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return _sessionId;
}

export default function ChatDrawer({ service = "", open, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Load suggested questions on mount
  useEffect(() => {
    advisorChatSuggestions()
      .then((r) => setSuggestions(r.suggestions || []))
      .catch(() => {});
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const ask = useCallback(async (question) => {
    if (!question.trim() || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setLoading(true);
    try {
      const res = await advisorChat({
        message: question,
        service,
        sessionId: getSessionId(),
      });
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: res.answer,
        tools: res.tools_called,
        method: res.method,
        proposal: res.proposal,
        asOf: res.as_of,
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: `Sentinel unavailable: ${err.message || "advisor offline"}`,
        error: true,
      }]);
    } finally {
      setLoading(false);
    }
  }, [service, loading]);

  if (!open) return null;

  return (
    <div className="chat-drawer-overlay" onClick={onClose}>
      <div className="chat-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="chat-drawer-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Bot size={20} style={{ color: "var(--accent)" }} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>Ask Sentinel</span>
            {service && (
              <span className="pill" style={{ fontSize: 11, padding: "2px 8px" }}>
                {service}
              </span>
            )}
          </div>
          <button className="chat-drawer-close" onClick={onClose} aria-label="Close chat">
            <X size={18} />
          </button>
        </div>

        {/* AI disclaimer */}
        <div className="chat-ai-label">
          <Shield size={12} /> AI-generated, verify before acting
        </div>

        {/* Messages */}
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-empty">
              <Zap size={24} style={{ color: "var(--accent)", marginBottom: 8 }} />
              <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 12px" }}>
                Ask about risk, time-to-failure, actions, thresholds, or drift.
              </p>
              {suggestions.length > 0 && (
                <div className="chat-chips">
                  {suggestions.slice(0, 5).map((q) => (
                    <button key={q} className="chat-chip" onClick={() => ask(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`chat-bubble chat-bubble-${msg.role}`}>
              <div className="chat-bubble-icon">
                {msg.role === "user" ? <User size={14} /> : <Bot size={14} />}
              </div>
              <div className="chat-bubble-content">
                <p>{msg.text}</p>
                {msg.tools && msg.tools.length > 0 && (
                  <div className="chat-tools">
                    {msg.tools.map((t) => <span key={t} className="chat-tool-tag">{t}</span>)}
                  </div>
                )}
                {msg.proposal && (
                  <div className="chat-proposal">
                    <div className="chat-proposal-header">
                      <span>Proposed: {msg.proposal.proposed_action}</span>
                      <span className="pill" style={{ fontSize: 10 }}>
                        {msg.proposal.requires_operator_approval ? "Approval Required" : "Tier 1"}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0" }}>
                      {msg.proposal.note}
                    </p>
                    <div className="chat-proposal-actions">
                      <button className="btn btn-approve" disabled>Approve (simulated)</button>
                      <button className="btn" onClick={() => setMessages((prev) => prev.filter((_, j) => j !== i))}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
                {msg.asOf && (
                  <div className="chat-asof">data as of {new Date(msg.asOf).toLocaleTimeString()}</div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="chat-bubble chat-bubble-assistant">
              <div className="chat-bubble-icon"><Bot size={14} /></div>
              <div className="chat-bubble-content">
                <p className="chat-typing">Thinking<span className="dots">...</span></p>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="chat-input-bar">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 500))}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && ask(input)}
            placeholder="Ask Sentinel..."
            className="chat-input"
            disabled={loading}
          />
          <button
            className="chat-send-btn"
            onClick={() => ask(input)}
            disabled={loading || !input.trim()}
            aria-label="Send"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
