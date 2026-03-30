import { useState, useRef } from "react";

type TagInputProps = {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
};

const TAG_REGEX = /^[a-zA-Z0-9\- ]+$/;
const MAX_TAG_LENGTH = 30;

export function TagInput({ tags, allTags, onChange }: TagInputProps) {
  const [input, setInput] = useState("");
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = input.trim()
    ? allTags
        .filter((t) => t.toLowerCase().includes(input.toLowerCase()) && !tags.includes(t))
        .slice(0, 5)
    : [];

  const addTag = (tag: string) => {
    const cleaned = tag.toLowerCase().trim();
    if (!cleaned || cleaned.length > MAX_TAG_LENGTH || !TAG_REGEX.test(cleaned)) return;
    if (tags.includes(cleaned)) return;
    onChange([...tags, cleaned]);
    setInput("");
    setFocusedIdx(-1);
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIdx >= 0 && focusedIdx < suggestions.length) {
        addTag(suggestions[focusedIdx]);
      } else if (input.trim()) {
        addTag(input);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      setInput("");
      setFocusedIdx(-1);
      setShowSuggestions(false);
      inputRef.current?.blur();
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      setShowSuggestions(false);
      setFocusedIdx(-1);
    }, 150);
  };

  return (
    <div>
      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
              style={{ background: "var(--surface)", color: "var(--text-secondary)" }}
            >
              #{tag}
              <button
                onClick={() => removeTag(tag)}
                className="ml-0.5 text-[10px] opacity-60 hover:opacity-100"
                style={{ color: "var(--text-secondary)" }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setFocusedIdx(-1);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder="Add a tag..."
          maxLength={MAX_TAG_LENGTH}
          className="w-full rounded-lg border px-3 py-2 text-sm box-border"
          style={{
            background: "var(--surface-hover)",
            borderColor: "var(--border)",
            color: "var(--foreground)",
          }}
        />
        {showSuggestions && suggestions.length > 0 && (
          <div
            className="absolute left-0 right-0 z-10 rounded-lg border shadow-lg"
            style={{
              background: "var(--background)",
              borderColor: "var(--border)",
              top: "calc(100% + 4px)",
            }}
          >
            {suggestions.map((s, i) => (
              <button
                key={s}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(s);
                }}
                className="block w-full px-3 py-2 text-left text-sm"
                style={{
                  color: "var(--foreground)",
                  background: i === focusedIdx ? "var(--surface)" : "transparent",
                }}
              >
                #{s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
